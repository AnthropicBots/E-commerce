const express = require("express");
const router = express.Router();

// Dummy product data
let products = [
  { id: 1, name: "Laptop", price: 50000 },
  { id: 2, name: "Phone", price: 20000 },
  { id: 3, name: "Headphones", price: 2000 }
];

// GET all products
router.get("/", (req, res) => {
  res.json(products);
});

// GET single product
router.get("/:id", (req, res) => {
  const product = products.find(p => p.id == req.params.id);
  if (!product) return res.status(404).json({ message: "Product not found" });
  res.json(product);
});

// ADD product
router.post("/", (req, res) => {
  const newProduct = {
    id: products.length + 1,
    name: req.body.name,
    price: req.body.price
  };
  products.push(newProduct);
  res.status(201).json(newProduct);
});

// DELETE product
router.delete("/:id", (req, res) => {
  products = products.filter(p => p.id != req.params.id);
  res.json({ message: "Product deleted" });
});

module.exports = router;
