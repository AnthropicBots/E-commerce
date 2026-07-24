const mysql = require("mysql2/promise");
require("dotenv").config();
const fs = require("fs");

const config = {
  allowProduction: process.env.ALLOW_PRODUCTION_SEED === "true" || false,
  clearExisting: process.env.CLEAR_EXISTING === "true" || false,
  skipDuplicates: process.env.SKIP_DUPLICATES !== "false",
  batchSize: parseInt(process.env.SEED_BATCH_SIZE) || 50,
  dataFile: process.env.SEED_DATA_FILE || null,
};

const products = [
  {
    name: "Classic Cotton T-Shirt",
    description: "Summer collection soft cotton tee.",
    price: 19.99,
    image: "/assets/images/f1.jpg",
    category: "T-Shirts",
    stock: 50,
    featured: 1,
  },
  {
    name: "Graphic Summer Tee",
    description: "Vibrant graphic tee for summer.",
    price: 24.99,
    image:
      "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcRyY_WkHP0-WBtjcePjG1sLSoMouKgAaav1hg&s",
    category: "T-Shirts",
    stock: 30,
    featured: 0,
  },
  {
    name: "Striped Casual Tee",
    description: "Comfortable striped tee.",
    price: 21.99,
    image:
      "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcQtKfu-ZwefkG7NDs5d3PhgFBSgTHhEN01ENQ&s",
    category: "T-Shirts",
    stock: 22,
    featured: 0,
  },
  {
    name: "V-Neck Tee",
    description: "Soft v-neck t-shirt.",
    price: 17.99,
    image:
      "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcTsSS_5k6nLRteqeDYfhRBiA65nBAAXQA2Nwg&s",
    category: "T-Shirts",
    stock: 18,
    featured: 0,
  },
  {
    name: "Pocket Tee",
    description: "Casual pocket tee.",
    price: 18.99,
    image:
      "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcRuw0Ab_4tzp6NAd8VHYZzV9OYF59aklaeEeA&s",
    category: "T-Shirts",
    stock: 12,
    featured: 0,
  },
  {
    name: "Cozy Hoodie",
    description: "Lightweight hoodie for cool evenings.",
    price: 39.99,
    image:
      "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcSPkTgVrxAbFAb4VMnRmqKfLq1mlPwKCf3PQg&s",
    category: "Hoodies",
    stock: 40,
    featured: 1,
  },
  {
    name: "Zip-Up Hoodie",
    description: "Casual zip hoodie.",
    price: 44.99,
    image:
      "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcQEk5MDT4E_9vjAF7bci9TCMuPYw_yUrdJ1Gw&s",
    category: "Hoodies",
    stock: 40,
    featured: 0,
  },
  {
    name: "Pullover Hoodie",
    description: "Cozy pullover style.",
    price: 42.99,
    image:
      "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcTua6NALhSutNTSeAx3JEGPipEhDhEoUAoISw&s",
    category: "Hoodies",
    stock: 28,
    featured: 0,
  },
  {
    name: "Fleece Hoodie",
    description: "Warm fleece hoodie.",
    price: 49.99,
    image: "/assets/images/f2.jpg",
    category: "Hoodies",
    stock: 14,
    featured: 0,
  },
  {
    name: "Sport Hoodie",
    description: "Performance hoodie for workouts.",
    price: 46.99,
    image: "/assets/images/f3.jpg",
    category: "Hoodies",
    stock: 32,
    featured: 0,
  },
  {
    name: "Windbreaker Jacket",
    description: "Water-resistant windbreaker.",
    price: 59.99,
    image:
      "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcRUk5pMwkIaq5m32eSfcLfuTTYXPd_gZxmDrg&s",
    category: "Jackets",
    stock: 20,
    featured: 0,
  },
  {
    name: "Denim Jacket",
    description: "Classic denim jacket.",
    price: 69.99,
    image:
      "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcS742gOUs3PYj6pGiEL7vxtCYtcdntbkSzg1Q&s",
    category: "Jackets",
    stock: 15,
    featured: 1,
  },
  {
    name: "Leather Jacket",
    description: "Stylish faux-leather jacket.",
    price: 119.99,
    image:
      "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcS3Zm904oGz9FyfDetC1LY41uK35Udmgl01bQ&s",
    category: "Jackets",
    stock: 8,
    featured: 0,
  },
  {
    name: "Bomber Jacket",
    description: "Classic bomber jacket.",
    price: 89.99,
    image:
      "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcTT_Z8bOxgvwY4ahNxGg4TkryUn2gowHQL51w&s",
    category: "Jackets",
    stock: 11,
    featured: 0,
  },
  {
    name: "Denim Trucker",
    description: "Lightweight trucker jacket.",
    price: 74.99,
    image:
      "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcQOazqR3Pt7KgK3iTwtReHvCLpQaIKhphOTjA&s",
    category: "Jackets",
    stock: 6,
    featured: 0,
  },
  {
    name: "Classic Ruled Notebook",
    description: "Durable ruled notebook for everyday class notes.",
    price: 4.99,
    image: "",
    category: "Notebooks",
    stock: 60,
    featured: 1,
  },
  {
    name: "Smooth Gel Pen Set",
    description: "Quick-dry gel pens for clean writing.",
    price: 6.99,
    image: "",
    category: "Pens",
    stock: 45,
    featured: 0,
  },
  {
    name: "Graphite Pencil Pack",
    description: "HB pencils for writing, sketching, and exams.",
    price: 3.49,
    image: "",
    category: "Pencils",
    stock: 80,
    featured: 0,
  },
  {
    name: "Ergonomic School Backpack",
    description: "Lightweight school bag with padded straps.",
    price: 24.99,
    image: "",
    category: "School Bags",
    stock: 25,
    featured: 0,
  },
  {
    name: "Desk Office Supplies Kit",
    description: "Stapler, clips, sticky notes, and organizer essentials.",
    price: 12.99,
    image: "",
    category: "Office Supplies",
    stock: 35,
    featured: 0,
  },
  {
    name: "Watercolor Art Supplies Set",
    description: "Paints, brushes, and sketch sheets for art projects.",
    price: 18.99,
    image: "",
    category: "Art Supplies",
    stock: 28,
    featured: 0,
  },
];

function validateProduct(product, index) {
  const errors = [];
  if (!product.name || product.name.trim().length === 0) {
    errors.push(`Product ${index}: Name is required`);
  }
  if (product.name && product.name.length > 255) {
    errors.push(`Product ${index}: Name too long (max 255)`);
  }
  if (product.price === undefined || product.price === null) {
    errors.push(`Product ${index}: Price is required`);
  } else if (typeof product.price !== "number" || product.price < 0) {
    errors.push(`Product ${index}: Invalid price ${product.price}`);
  }
  if (product.stock === undefined || product.stock === null) {
    errors.push(`Product ${index}: Stock is required`);
  } else if (typeof product.stock !== "number" || product.stock < 0) {
    errors.push(`Product ${index}: Invalid stock ${product.stock}`);
  }
  if (!product.category || product.category.trim().length === 0) {
    errors.push(`Product ${index}: Category is required`);
  }
  if (product.image && typeof product.image !== "string") {
    errors.push(`Product ${index}: Invalid image path`);
  }
  if (product.image && product.image.length > 500) {
    errors.push(`Product ${index}: Image URL too long`);
  }
  if (product.description && product.description.length > 1000) {
    errors.push(`Product ${index}: Description too long (max 1000)`);
  }
  return errors;
}

function loadProducts() {
  if (config.dataFile && fs.existsSync(config.dataFile)) {
    try {
      const fileData = fs.readFileSync(config.dataFile, "utf8");
      const loaded = JSON.parse(fileData);
      if (Array.isArray(loaded) && loaded.length > 0) {
        console.log(`Loaded ${loaded.length} products from file`);
        return loaded;
      }
    } catch (error) {
      console.warn(`Could not load data file: ${error.message}`);
    }
  }
  return products;
}

async function seed() {
  console.log("\n Starting database seeding...\n");

  if (process.env.NODE_ENV === "production" && !config.allowProduction) {
    console.error("Cannot seed production database!");
    console.error("Set ALLOW_PRODUCTION_SEED=true to override");
    process.exit(1);
  }

  let connection;

  try {
    connection = await mysql.createConnection({
      host: process.env.DB_HOST || "localhost",
      user: process.env.DB_USER || "root",
      password: process.env.DB_PASSWORD || "",
      database: process.env.DB_NAME || "ecommerce",
      port: process.env.DB_PORT || 3306,
      multipleStatements: true,
    });

    console.log("Connected to database");

    const [existingRows] = await connection.execute(
      "SELECT COUNT(*) as count FROM products",
    );
    const existingCount = existingRows[0].count;
    console.log(`Existing products: ${existingCount}`);

    if (config.clearExisting) {
      console.log("Clearing existing products...");
      await connection.execute("DELETE FROM products");
      await connection.execute("ALTER TABLE products AUTO_INCREMENT = 1");
      console.log("Existing products cleared");
    }

    const productData = loadProducts();
    console.log(`Loaded ${productData.length} products`);

    if (productData.length === 0) {
      console.log("No products to seed");
      await connection.end();
      return;
    }

    const validationErrors = [];
    productData.forEach((p, i) => {
      const errors = validateProduct(p, i);
      if (errors.length > 0) {
        validationErrors.push(...errors);
      }
    });

    if (validationErrors.length > 0) {
      console.error("\n Validation errors:");
      validationErrors.forEach((err) => console.error(`   ${err}`));
      await connection.end();
      process.exit(1);
    }

    await connection.beginTransaction();

    let inserted = 0;
    let skipped = 0;
    const errors = [];
    const existingProducts = new Set();

    if (config.skipDuplicates) {
      const [rows] = await connection.execute("SELECT name FROM products");
      rows.forEach((row) => existingProducts.add(row.name));
    }

    const batch = [];
    let batchCount = 0;

    for (let i = 0; i < productData.length; i++) {
      const product = productData[i];

      if (config.skipDuplicates && existingProducts.has(product.name)) {
        skipped++;
        continue;
      }

      const slug =
        product.slug ||
        product.name
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-+|-+$/g, "");

      batch.push([
        product.name,
        product.description || "",
        product.price,
        product.image || "",
        product.category,
        product.stock || 0,
        product.featured || 0,
        slug,
      ]);

      batchCount++;

      if (batch.length >= config.batchSize) {
        const placeholders = batch
          .map(() => "(?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())")
          .join(", ");

        const values = batch.flat();

        try {
          const query = `
                        INSERT INTO products 
                        (name, description, price, image, category, stock, featured, slug, created_at, updated_at)
                        VALUES ${placeholders}
                    `;
          await connection.execute(query, values);
          inserted += batch.length;
        } catch (error) {
          errors.push(`Batch ${batchCount} failed: ${error.message}`);
        }

        batch.length = 0;
        batchCount++;
      }
    }

    if (batch.length > 0) {
      const placeholders = batch
        .map(() => "(?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())")
        .join(", ");

      const values = batch.flat();

      try {
        const query = `
                    INSERT INTO products 
                    (name, description, price, image, category, stock, featured, slug, created_at, updated_at)
                    VALUES ${placeholders}
                `;
        await connection.execute(query, values);
        inserted += batch.length;
      } catch (error) {
        errors.push(`Final batch failed: ${error.message}`);
      }
    }

    await connection.commit();

    console.log("\n Seeding complete!");
    console.log(`   Inserted: ${inserted}`);
    console.log(`   Skipped: ${skipped}`);

    if (errors.length > 0) {
      console.log(`\n Errors: ${errors.length}`);
      errors.forEach((err) => console.log(`    ${err}`));
    }

    const [finalRows] = await connection.execute(
      "SELECT COUNT(*) as count FROM products",
    );
    console.log(`\n Final products in database: ${finalRows[0].count}`);
  } catch (error) {
    console.error("\n Seeding failed:", error.message);

    if (connection) {
      try {
        await connection.rollback();
        console.log("Transaction rolled back");
      } catch (rollbackError) {
        console.error("Rollback failed:", rollbackError.message);
      }
    }

    if (error.stack) {
      console.error(error.stack);
    }

    process.exit(1);
  } finally {
    if (connection) {
      await connection.end();
      console.log("Database connection closed");
    }
  }
}

function parseArgs() {
  const args = process.argv.slice(2);
  args.forEach((arg) => {
    if (arg === "--clear" || arg === "-c") {
      config.clearExisting = true;
    }
    if (arg === "--force" || arg === "-f") {
      config.allowProduction = true;
    }
    if (arg === "--no-skip") {
      config.skipDuplicates = false;
    }
    if (arg.startsWith("--batch=")) {
      const size = parseInt(arg.split("=")[1]);
      if (!isNaN(size) && size > 0) {
        config.batchSize = size;
      }
    }
    if (arg.startsWith("--file=")) {
      config.dataFile = arg.split("=")[1];
    }
  });
}

parseArgs();

if (require.main === module) {
  seed().catch((error) => {
    console.error("Unhandled error:", error);
    process.exit(1);
  });
}

module.exports = { seed, validateProduct, loadProducts };
