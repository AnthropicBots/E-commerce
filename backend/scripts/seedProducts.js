const db = require('../config/db');
const crypto = require('crypto');

const sampleProducts = [
  {
    name: 'Classic Cotton T-Shirt',
    description: 'Soft cotton tee, regular fit.',
    price: 19.99,
    image: '/assets/images/tshirt1.jpg',
    category: 'T-Shirts',
    stock: 50,
    featured: 1
  },
  {
    name: 'Graphic Tee',
    description: 'Stylish graphic print t-shirt.',
    price: 24.99,
    image: '/assets/images/tshirt2.jpg',
    category: 'T-Shirts',
    stock: 30,
    featured: 0
  },
  {
    name: 'Cozy Hoodie',
    description: 'Warm pullover hoodie with fleece lining.',
    price: 39.99,
    image: '/assets/images/hoodie1.jpg',
    category: 'Hoodies',
    stock: 40,
    featured: 1
  },
  {
    name: 'Zip-Up Hoodie',
    description: 'Lightweight zip hoodie for everyday wear.',
    price: 44.99,
    image: '/assets/images/hoodie2.jpg',
    category: 'Hoodies',
    stock: 25,
    featured: 0
  },
  {
    name: 'Windbreaker Jacket',
    description: 'Water-resistant windbreaker.',
    price: 59.99,
    image: '/assets/images/jacket1.jpg',
    category: 'Jackets',
    stock: 20,
    featured: 1
  },
  {
    name: 'Denim Jacket',
    description: 'Classic denim jacket.',
    price: 69.99,
    image: '/assets/images/jacket2.jpg',
    category: 'Jackets',
    stock: 15,
    featured: 0
  },
  {
    name: 'Classic Ruled Notebook',
    description: 'Durable ruled notebook for everyday class notes.',
    price: 4.99,
    image: '',
    category: 'Notebooks',
    stock: 60,
    featured: 1
  },
  {
    name: 'Smooth Gel Pen Set',
    description: 'Quick-dry gel pens for clean writing.',
    price: 6.99,
    image: '',
    category: 'Pens',
    stock: 45,
    featured: 0
  },
  {
    name: 'Graphite Pencil Pack',
    description: 'HB pencils for writing, sketching, and exams.',
    price: 3.49,
    image: '',
    category: 'Pencils',
    stock: 80,
    featured: 0
  },
  {
    name: 'Ergonomic School Backpack',
    description: 'Lightweight school bag with padded straps.',
    price: 24.99,
    image: '',
    category: 'School Bags',
    stock: 25,
    featured: 0
  },
  {
    name: 'Desk Office Supplies Kit',
    description: 'Stapler, clips, sticky notes, and organizer essentials.',
    price: 12.99,
    image: '',
    category: 'Office Supplies',
    stock: 35,
    featured: 0
  },
  {
    name: 'Watercolor Art Supplies Set',
    description: 'Paints, brushes, and sketch sheets for art projects.',
    price: 18.99,
    image: '',
    category: 'Art Supplies',
    stock: 28,
    featured: 0
  }
];

(async function seed() {
  try {
    // Resolve all categories to IDs first
    const categoryNameToId = new Map();
    const uniqueCategoryNames = [...new Set(sampleProducts.map(p => p.category).filter(Boolean))];
    
    for (const catName of uniqueCategoryNames) {
        const trimmed = catName.trim();
        const [rows] = await db.query(
            "SELECT id FROM categories WHERE LOWER(TRIM(name)) = LOWER(?) LIMIT 1",
            [trimmed]
        );
        if (rows.length > 0) {
            categoryNameToId.set(trimmed, rows[0].id);
        } else {
            const slug = trimmed
                .toLowerCase()
                .replace(/[^a-z0-9]+/g, "-")
                .replace(/^-+|-+$/g, "");
            
            const [result] = await db.query(
                "INSERT INTO categories (name, slug, level, is_active) VALUES (?, ?, 0, 1)",
                [trimmed, slug]
            );
            categoryNameToId.set(trimmed, result.insertId);
        }
    }

    for (const p of sampleProducts) {
      const categoryId = categoryNameToId.get(p.category) || null;
      const productId = crypto.randomUUID();
      const slug = p.name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");

      const query = `INSERT INTO products (id, name, description, price, image, category_id, stock, featured, slug) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`;
      await db.query(query, [productId, p.name, p.description, p.price, p.image, categoryId, p.stock, p.featured, slug]);
      console.log('Inserted product id:', productId, p.name);
    }
    console.log('Seeding complete.');
    process.exit(0);
  } catch (err) {
    console.error('Seeding failed:', err.message || err);
    process.exit(1);
  }
})();
