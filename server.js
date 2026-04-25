const express = require("express");
const cors = require("cors");
const productRoutes = require("./routes/products");

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// Routes
app.use("/api/products", productRoutes);

// Home route
app.get("/", (req, res) => {
  res.send("E-Commerce Backend Running 🚀");
});

// Server start
const PORT = 5000;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
