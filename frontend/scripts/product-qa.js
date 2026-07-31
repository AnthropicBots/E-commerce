// frontend/scripts/product-qa.js
//
// Product questions and answers (#1353).
//
// A shopper with a pre-purchase question had nowhere to put it: the review form
// is closed to anyone who has not already received the product, which is
// correct for reviews and is exactly why questions had no home.
//
// Classic <script> file, not a module -- product.html loads plain <script> tags.

(function () {
    "use strict";

    var state = {
        productId: null,
        questions: [],
        limits: { minQuestionLength: 10, maxQuestionLength: 1000 },
        loaded: false
    };

    /**
     * Escape text bound for innerHTML.
     *
     * Questions and answers are free text from arbitrary signed-in users,
     * rendered on the product page. This is the difference between a Q&A
     * section and a stored XSS. AppUtils.escapeHTML is preferred; the inline
     * fallback means the module is not silently unsafe if utils.js fails to
     * load, which is the failure mode #1276 was about.
     */
    function esc(value) {
        if (window.AppUtils && typeof AppUtils.escapeHTML === "function") {
            return AppUtils.escapeHTML(value == null ? "" : String(value));
        }

        return String(value == null ? "" : value)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#39;");
    }

    function notify(message, type) {
        if (window.AppUtils && typeof AppUtils.notify === "function") {
            AppUtils.notify(message, type || "info");
        }
    }

    function formatDate(value) {
        var date = new Date(value);
        if (isNaN(date.getTime())) return "";

        return date.toLocaleDateString(undefined, {
            day: "numeric",
            month: "short",
            year: "numeric"
        });
    }

    /**
     * The badge next to an answerer's name.
     *
     * A shopper reading an answer needs to know which of these they are
     * reading: an answer from someone holding the product is worth more than a
     * guess, and rendering them identically is how a confident guess outranks
     * the truth.
     */
    function authorBadge(answer) {
        if (answer.isSeller) {
            return '<span class="qa-badge qa-badge-seller">Seller</span>';
        }

        if (answer.isVerifiedOwner) {
            return (
                '<span class="qa-badge qa-badge-owner">' +
                '<i class="fas fa-check-circle" aria-hidden="true"></i> Verified owner' +
                "</span>"
            );
        }

        return "";
    }

    function answerHTML(answer) {
        return (
            '<li class="qa-answer" data-answer-id="' +
            esc(answer.id) +
            '">' +
            '<div class="qa-answer-head">' +
            '<span class="qa-author">' +
            esc(answer.userName) +
            "</span>" +
            authorBadge(answer) +
            '<time class="qa-date">' +
            esc(formatDate(answer.createdAt)) +
            "</time>" +
            "</div>" +
            '<p class="qa-answer-body">' +
            esc(answer.body) +
            "</p>" +
            '<div class="qa-answer-actions">' +
            '<button type="button" class="qa-helpful-btn' +
            (answer.viewerHasVotedHelpful ? " is-active" : "") +
            '" data-target-type="answer" data-target-id="' +
            esc(answer.id) +
            '" aria-pressed="' +
            (answer.viewerHasVotedHelpful ? "true" : "false") +
            '">' +
            '<i class="far fa-thumbs-up" aria-hidden="true"></i> Helpful' +
            (answer.helpfulCount > 0 ? " (" + answer.helpfulCount + ")" : "") +
            "</button>" +
            (answer.viewerHasReported
                ? '<span class="qa-reported">Reported</span>'
                : '<button type="button" class="qa-report-btn" data-target-type="answer" data-target-id="' +
                  esc(answer.id) +
                  '">Report</button>') +
            "</div>" +
            "</li>"
        );
    }

    function questionHTML(question) {
        var answers = question.answers || [];

        return (
            '<article class="qa-question" data-question-id="' +
            esc(question.id) +
            '">' +
            '<header class="qa-question-head">' +
            '<p class="qa-question-body"><span class="qa-q-marker">Q</span>' +
            esc(question.body) +
            "</p>" +
            '<div class="qa-question-meta">' +
            '<span class="qa-author">' +
            esc(question.userName) +
            "</span>" +
            '<time class="qa-date">' +
            esc(formatDate(question.createdAt)) +
            "</time>" +
            '<button type="button" class="qa-helpful-btn' +
            (question.viewerHasVotedHelpful ? " is-active" : "") +
            '" data-target-type="question" data-target-id="' +
            esc(question.id) +
            '" aria-pressed="' +
            (question.viewerHasVotedHelpful ? "true" : "false") +
            '">' +
            '<i class="far fa-thumbs-up" aria-hidden="true"></i> Same question' +
            (question.helpfulCount > 0 ? " (" + question.helpfulCount + ")" : "") +
            "</button>" +
            "</div>" +
            "</header>" +
            (answers.length
                ? '<ul class="qa-answers">' + answers.map(answerHTML).join("") + "</ul>"
                : '<p class="qa-unanswered">No answers yet — if you own this, you can help.</p>') +
            '<form class="qa-answer-form" data-question-id="' +
            esc(question.id) +
            '">' +
            '<label class="sr-only" for="qa-answer-' +
            esc(question.id) +
            '">Your answer</label>' +
            '<textarea id="qa-answer-' +
            esc(question.id) +
            '" name="body" rows="2" maxlength="2000" placeholder="Answer this question"></textarea>' +
            '<button type="submit">Post answer</button>' +
            "</form>" +
            "</article>"
        );
    }

    function render() {
        var list = document.getElementById("qa-list");
        if (!list) return;

        if (state.questions.length === 0) {
            list.innerHTML =
                '<p class="qa-empty">No questions yet. Ask the first one — the seller and other owners can answer.</p>';
            return;
        }

        list.innerHTML = state.questions.map(questionHTML).join("");
    }

    async function load() {
        if (!state.productId || !window.AppUtils || !AppUtils.apiRequest) return;

        try {
            var response = await AppUtils.apiRequest(
                "/products/" + encodeURIComponent(state.productId) + "/questions"
            );

            if (!response || !response.success) return;

            state.questions = response.questions || [];
            state.limits = response.limits || state.limits;
            state.loaded = true;

            render();
        } catch (error) {
            // Q&A is supplementary to the product page. A product that renders
            // without its Q&A section is far better than one showing an error
            // because a secondary call failed.
            console.error("LOAD PRODUCT QA ERROR:", error);
        }
    }

    async function askQuestion(event) {
        event.preventDefault();

        if (!AppUtils.requireAuth || !AppUtils.requireAuth()) return;

        var field = document.getElementById("qa-question-input");
        var body = field ? field.value.trim() : "";

        // Checked here as well as server-side so a shopper is told before the
        // round trip, using the server's own limits rather than a second copy
        // of them that can drift.
        if (body.length < state.limits.minQuestionLength) {
            notify(
                "A question needs at least " +
                    state.limits.minQuestionLength +
                    " characters.",
                "error"
            );
            return;
        }

        try {
            var response = await AppUtils.apiRequest(
                "/products/" + encodeURIComponent(state.productId) + "/questions",
                { method: "POST", body: JSON.stringify({ body: body }) }
            );

            if (!response || !response.success) {
                throw new Error((response && response.message) || "Could not post your question");
            }

            notify(response.message, "success");
            if (field) field.value = "";
            await load();
        } catch (error) {
            console.error("ASK QUESTION ERROR:", error);
            notify(error.message || "Could not post your question", "error");
        }
    }

    async function submitAnswer(form) {
        if (!AppUtils.requireAuth || !AppUtils.requireAuth()) return;

        var questionId = form.getAttribute("data-question-id");
        var field = form.querySelector('[name="body"]');
        var body = field ? field.value.trim() : "";

        if (!body) {
            notify("Write an answer first.", "error");
            return;
        }

        try {
            var response = await AppUtils.apiRequest(
                "/products/questions/" + encodeURIComponent(questionId) + "/answers",
                { method: "POST", body: JSON.stringify({ body: body }) }
            );

            if (!response || !response.success) {
                throw new Error((response && response.message) || "Could not post your answer");
            }

            notify("Answer posted.", "success");
            await load();
        } catch (error) {
            console.error("ANSWER QUESTION ERROR:", error);
            notify(error.message || "Could not post your answer", "error");
        }
    }

    /**
     * Vote or withdraw a vote.
     *
     * No optimistic update: the server is the only thing that knows whether
     * this user has already voted, and showing a count the next load
     * contradicts is worse than a brief wait.
     */
    async function toggleHelpful(targetType, targetId, alreadyVoted) {
        if (!AppUtils.requireAuth || !AppUtils.requireAuth()) return;

        var path =
            targetType === "question"
                ? "/products/questions/" + encodeURIComponent(targetId) + "/helpful"
                : "/products/answers/" + encodeURIComponent(targetId) + "/helpful";

        try {
            var response = await AppUtils.apiRequest(path, {
                method: alreadyVoted ? "DELETE" : "POST"
            });

            if (!response || !response.success) {
                throw new Error((response && response.message) || "Could not record your vote");
            }

            await load();
        } catch (error) {
            console.error("QA VOTE ERROR:", error);
            notify(error.message || "Could not record your vote", "error");
        }
    }

    async function report(targetType, targetId) {
        if (!AppUtils.requireAuth || !AppUtils.requireAuth()) return;

        var reason = window.prompt(
            "Why are you reporting this?\n\n" +
                "spam, offensive, off_topic, personal_info, or other\n\n" +
                "It will be sent to a moderator to look at.",
            "spam"
        );

        if (reason === null) return;

        var path =
            targetType === "question"
                ? "/products/questions/" + encodeURIComponent(targetId) + "/report"
                : "/products/answers/" + encodeURIComponent(targetId) + "/report";

        try {
            var response = await AppUtils.apiRequest(path, {
                method: "POST",
                body: JSON.stringify({ reason: reason })
            });

            if (!response || !response.success) {
                throw new Error((response && response.message) || "Could not report this");
            }

            notify(response.message, "success");
            await load();
        } catch (error) {
            console.error("QA REPORT ERROR:", error);
            notify(error.message || "Could not report this", "error");
        }
    }

    function init() {
        var section = document.getElementById("product-qa");
        if (!section) return;

        state.productId = new URLSearchParams(window.location.search).get("id");
        if (!state.productId) return;

        var askForm = document.getElementById("qa-ask-form");
        if (askForm) askForm.addEventListener("submit", askQuestion);

        // One delegated listener each, because the list is re-rendered
        // wholesale on every change and per-element bindings would leak.
        var list = document.getElementById("qa-list");

        list?.addEventListener("click", function (event) {
            var helpful = event.target.closest(".qa-helpful-btn");

            if (helpful) {
                toggleHelpful(
                    helpful.dataset.targetType,
                    helpful.dataset.targetId,
                    helpful.classList.contains("is-active")
                );
                return;
            }

            var reportButton = event.target.closest(".qa-report-btn");

            if (reportButton) {
                report(reportButton.dataset.targetType, reportButton.dataset.targetId);
            }
        });

        list?.addEventListener("submit", function (event) {
            var form = event.target.closest(".qa-answer-form");
            if (!form) return;

            event.preventDefault();
            submitAnswer(form);
        });

        load();
    }

    window.ProductQA = {
        load: load,
        render: render,
        getQuestions: function () {
            return state.questions.slice();
        }
    };

    document.addEventListener("DOMContentLoaded", init);
})();
