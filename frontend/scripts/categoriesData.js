// frontend/scripts/categoriesData.js
(function () {
    "use strict";

    const CATEGORIES = [
        {
            id: "fashion",
            name: "Fashion",
            icon: "fas fa-tshirt",
            subcategories: ["Men's Clothing", "Women's Clothing", "Kids Wear", "Footwear", "Watches", "Bags", "Accessories"]
        },
        {
            id: "electronics",
            name: "Electronics",
            icon: "fas fa-laptop",
            subcategories: ["Mobiles", "Laptops", "Tablets", "Smart Watches", "Headphones", "Cameras", "Gaming"]
        },
        {
            id: "grocery",
            name: "Grocery",
            icon: "fas fa-shopping-basket",
            subcategories: ["Fruits & Vegetables", "Dairy", "Snacks", "Beverages", "Cooking Essentials", "Household Supplies"]
        },
        {
            id: "toys",
            name: "Toys",
            icon: "fas fa-puzzle-piece",
            subcategories: ["Educational Toys", "Building Blocks", "Dolls", "RC Toys", "Outdoor Toys"]
        },
        {
            id: "stationery",
            name: "Stationery",
            icon: "fas fa-pen-nib",
            subcategories: ["Notebooks", "Pens", "Pencils", "School Bags", "Office Supplies", "Art Supplies"]
        },
        {
            id: "home-kitchen",
            name: "Home & Kitchen",
            icon: "fas fa-home",
            subcategories: ["Furniture", "Cookware", "Storage", "Home Decor", "Bedding", "Kitchen Appliances"]
        },
        {
            id: "beauty",
            name: "Beauty",
            icon: "fas fa-magic",
            subcategories: ["Skincare", "Makeup", "Haircare", "Fragrances", "Personal Care"]
        }
    ];

    const FALLBACK_PRODUCTS = [
        { id: 'ft1', name: 'Classic Cotton T-Shirt', description: 'Summer collection soft cotton tee.', price: 19.99, image: '', category: 'T-Shirts', stock: 50, rating: 4, sales_count: 190 },
        { id: 'ft2', name: 'Graphic Summer Tee', description: 'Vibrant graphic tee for summer.', price: 24.99, image: '', category: 'T-Shirts', stock: 30, rating: 5, sales_count: 320 },
        { id: 'ft3', name: 'Striped Casual Tee', description: 'Comfortable striped tee.', price: 21.99, image: '', category: 'T-Shirts', stock: 22, rating: 4, sales_count: 450 },
        { id: 'ft4', name: 'V-Neck Tee', description: 'Soft v-neck t-shirt.', price: 17.99, image: '', category: 'T-Shirts', stock: 18, rating: 4, sales_count: 210 },
        { id: 'ft5', name: 'Pocket Tee', description: 'Casual pocket tee.', price: 18.99, image: '', category: 'T-Shirts', stock: 12, rating: 4, sales_count: 180 },
        { id: 'fh1', name: 'Cozy Hoodie', description: 'Lightweight hoodie for cool evenings.', price: 39.99, image: '', category: 'Hoodies', stock: 40, rating: 4, sales_count: 95 },
        { id: 'fh2', name: 'Zip-Up Hoodie', description: 'Casual zip hoodie.', price: 44.99, image: '', category: 'Hoodies', stock: 40, rating: 4, sales_count: 280},
        { id: 'fh3', name: 'Pullover Hoodie', description: 'Cozy pullover style.', price: 42.99, image: '', category: 'Hoodies', stock: 28, rating: 4, sales_count: 310 },
        { id: 'fh4', name: 'Fleece Hoodie', description: 'Warm fleece hoodie.', price: 49.99, image: '', category: 'Hoodies', stock: 14, rating: 5, sales_count: 190 },
        { id: 'fh5', name: 'Sport Hoodie', description: 'Performance hoodie for workouts.', price: 46.99, image: '', category: 'Hoodies', stock: 32, rating: 4, sales_count: 420 },
        { id: 'fj1', name: 'Windbreaker Jacket', description: 'Water-resistant windbreaker.', price: 59.99, image: '', category: 'Jackets', stock: 20, rating: 4, sales_count: 260 },
        { id: 'fj2', name: 'Denim Jacket', description: 'Classic denim jacket.', price: 69.99, image: '', category: 'Jackets', stock: 15, rating: 5, sales_count: 150 },
        { id: 'fj3', name: 'Leather Jacket', description: 'Stylish faux-leather jacket.', price: 119.99, image: '', category: 'Jackets', stock: 8, rating: 5, sales_count: 380 },
        { id: 'fj4', name: 'Bomber Jacket', description: 'Classic bomber jacket.', price: 89.99, image: '', category: 'Jackets', stock: 11, rating: 4, sales_count: 290 },
        { id: 'fj5', name: 'Denim Trucker', description: 'Lightweight trucker jacket.', price: 74.99, image: '', category: 'Jackets', stock: 6, rating: 4 , sales_count: 175},
        { id: 'st1', name: 'Classic Ruled Notebook', description: 'Durable ruled notebook for everyday class notes.', price: 4.99, image: '', category: 'Notebooks', stock: 60, rating: 4, tags: ['Stationery', 'Notebooks'] },
        { id: 'st2', name: 'Smooth Gel Pen Set', description: 'Quick-dry gel pens for clean writing.', price: 6.99, image: '', category: 'Pens', stock: 45, rating: 5, tags: ['Stationery', 'Pens'] },
        { id: 'st3', name: 'Graphite Pencil Pack', description: 'HB pencils for writing, sketching, and exams.', price: 3.49, image: '', category: 'Pencils', stock: 80, rating: 4, tags: ['Stationery', 'Pencils'] },
        { id: 'st4', name: 'Ergonomic School Backpack', description: 'Lightweight school bag with padded straps.', price: 24.99, image: '', category: 'School Bags', stock: 25, rating: 4, tags: ['Stationery', 'School Bags'] },
        { id: 'st5', name: 'Desk Office Supplies Kit', description: 'Stapler, clips, sticky notes, and organizer essentials.', price: 12.99, image: '', category: 'Office Supplies', stock: 35, rating: 4, tags: ['Stationery', 'Office Supplies'] },
        { id: 'st6', name: 'Watercolor Art Supplies Set', description: 'Paints, brushes, and sketch sheets for art projects.', price: 18.99, image: '', category: 'Art Supplies', stock: 28, rating: 5, tags: ['Stationery', 'Art Supplies'] }
    ];

    window.CATEGORIES_DATA = {
        categories: CATEGORIES,
        fallbackProducts: FALLBACK_PRODUCTS
    };
})();
