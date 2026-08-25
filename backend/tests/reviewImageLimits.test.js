// backend/tests/reviewImageLimits.test.js
//
// Review photos are inlined as base64 in the JSON body, so their size is not a
// storage question -- it is arithmetic against `appConfig.bodyLimit`, and it
// was wrong in both directions (#1654):
//
//   - a data URI over the cap was `slice()`d, and the truncated string still
//     began `data:image/jpeg;base64,`, so it passed the filter and was stored:
//     an undecodable URI that renders as a broken image forever
//   - five images at 5,000,000 characters is a 25MB ceiling against a 10MB
//     door, so three ordinary phone photos 413ed before reaching any of this

jest.mock("../config/db", () => ({
    query: jest.fn(),
    getConnection: jest.fn()
}));

const {
    normalizeReviewImages,
    MAX_REVIEW_IMAGES,
    MAX_REVIEW_IMAGE_CHARS
} = require("../controllers/reviewController");

const appConfig = require("../config/appConfig");

const dataUri = (chars, mime = "image/jpeg") =>
    `data:${mime};base64,${"A".repeat(chars)}`;

const bodyLimitBytes = () => {
    const match = String(appConfig.bodyLimit).match(/^(\d+)\s*mb$/i);
    return Number(match[1]) * 1024 * 1024;
};

describe("the caps fit through the door", () => {
    test("bodyLimit is expressed in whole megabytes", () => {
        expect(String(appConfig.bodyLimit)).toMatch(/^\d+mb$/i);
    });

    test("a full set of images fits inside the request body limit", () => {
        // The regression, stated as the arithmetic that failed:
        // 5 x 5,000,000 = 25,000,000 against a 10,485,760 byte limit.
        const worstCase = MAX_REVIEW_IMAGES * MAX_REVIEW_IMAGE_CHARS;

        expect(worstCase).toBeLessThan(bodyLimitBytes());
    });

    test("leaves room for the rest of the review", () => {
        // Not just under the limit -- under it with the comment, title, rating
        // and JSON envelope still to fit.
        const worstCase = MAX_REVIEW_IMAGES * MAX_REVIEW_IMAGE_CHARS;

        expect(worstCase).toBeLessThan(bodyLimitBytes() * 0.8);
    });
});

describe("normalizeReviewImages", () => {
    test("keeps a data URI inside the cap intact", () => {
        const image = dataUri(1000);

        expect(normalizeReviewImages([image])).toEqual([image]);
    });

    test("keeps one exactly at the cap", () => {
        const prefix = "data:image/jpeg;base64,";
        const image = prefix + "A".repeat(MAX_REVIEW_IMAGE_CHARS - prefix.length);

        expect(image.length).toBe(MAX_REVIEW_IMAGE_CHARS);
        expect(normalizeReviewImages([image])).toEqual([image]);
    });

    test("drops an oversized data URI rather than truncating it", () => {
        const image = dataUri(MAX_REVIEW_IMAGE_CHARS + 1);

        expect(normalizeReviewImages([image])).toEqual([]);
    });

    test("never returns a data URI it has cut short", () => {
        // The precise failure: the old code returned `str.slice(0, 5000000)`,
        // which is still prefixed `data:image/...;base64,` and so survived the
        // filter below it. Nothing that comes back may be shorter than it went
        // in.
        const images = [
            dataUri(200),
            dataUri(MAX_REVIEW_IMAGE_CHARS * 2),
            dataUri(5000)
        ];

        const result = normalizeReviewImages(images);

        for (const url of result) {
            expect(images).toContain(url);
        }

        expect(result).toEqual([dataUri(200), dataUri(5000)]);
    });

    test("an oversized image does not take the others with it", () => {
        const good = dataUri(100);

        expect(normalizeReviewImages([good, dataUri(MAX_REVIEW_IMAGE_CHARS + 50)]))
            .toEqual([good]);
    });

    test("accepts the mime types the column is meant to hold", () => {
        for (const mime of ["image/png", "image/jpeg", "image/jpg", "image/webp", "image/gif"]) {
            expect(normalizeReviewImages([dataUri(50, mime)])).toHaveLength(1);
        }
    });

    test("still takes http(s) URLs, trimmed at 500", () => {
        const long = `https://cdn.example.com/${"a".repeat(900)}.jpg`;

        const [result] = normalizeReviewImages([long]);

        expect(result).toHaveLength(500);
        expect(result.startsWith("https://cdn.example.com/")).toBe(true);
    });

    test("refuses anything that is not an image URL", () => {
        // A javascript: URL in an image list is stored XSS (#1276).
        expect(
            normalizeReviewImages([
                "javascript:alert(1)",
                "data:text/html;base64,PHNjcmlwdD4=",
                "data:application/pdf;base64,JVBERi0=",
                "ftp://example.com/x.png",
                "",
                null,
                undefined,
                42
            ])
        ).toEqual([]);
    });

    test("caps the number of photos", () => {
        const many = Array.from({ length: MAX_REVIEW_IMAGES + 4 }, () => dataUri(10));

        expect(normalizeReviewImages(many)).toHaveLength(MAX_REVIEW_IMAGES);
    });

    test("the count cap is applied before the size rule, so it cannot be widened", () => {
        // Oversized entries are dropped after the slice, so a caller cannot
        // push a sixth valid photo through by padding the list with rejects.
        const images = [
            ...Array.from({ length: MAX_REVIEW_IMAGES }, () =>
                dataUri(MAX_REVIEW_IMAGE_CHARS + 1)
            ),
            dataUri(10)
        ];

        expect(normalizeReviewImages(images)).toEqual([]);
    });

    test("a non-array is no images", () => {
        expect(normalizeReviewImages(undefined)).toEqual([]);
        expect(normalizeReviewImages(null)).toEqual([]);
        expect(normalizeReviewImages("data:image/png;base64,AAA")).toEqual([]);
        expect(normalizeReviewImages({ 0: "x", length: 1 })).toEqual([]);
    });
});

describe("the frontend downscales to the same cap", () => {
    const fs = require("fs");
    const path = require("path");

    const source = fs.readFileSync(
        path.join(__dirname, "..", "..", "frontend", "scripts", "product-reviews.js"),
        "utf8"
    );

    test("states the same per-image cap the server enforces", () => {
        const match = source.match(/MAX_REVIEW_IMAGE_CHARS\s*=\s*(\d+)/);

        expect(match).not.toBeNull();
        expect(Number(match[1])).toBe(MAX_REVIEW_IMAGE_CHARS);
    });

    test("resizes rather than uploading whatever the camera produced", () => {
        expect(source).toMatch(/downscaleToLimit/);
        expect(source).toMatch(/canvas/i);
        expect(source).toMatch(/toDataURL\(\s*["']image\/jpeg["']/);
    });

    test("refuses a photo it cannot get under the cap", () => {
        // Before this, a file that could not fit was uploaded anyway and the
        // server stored a truncated copy of it.
        expect(source).toMatch(/too large to attach/i);
    });
});
