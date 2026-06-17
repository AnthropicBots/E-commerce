const db = require('../config/db');

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
  }
];

(async function seed() {
  try {
    for (const p of sampleProducts) {
      const query = `INSERT INTO products (name, description, price, image, category, stock, featured) VALUES (?, ?, ?, ?, ?, ?, ?)`;
      const [result] = await db.query(query, [p.name, p.description, p.price, p.image, p.category, p.stock, p.featured]);
      console.log('Inserted product id:', result.insertId, p.name);
    }
    console.log('Seeding complete.');
    process.exit(0);
  } catch (err) {
    console.error('Seeding failed:', err.message || err);
    process.exit(1);
  }
})();
