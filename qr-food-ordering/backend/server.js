const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const cors = require('cors');
const QRCode = require('qrcode');
const multer = require('multer');
const fs = require('fs');

const app = express();
const PORT = 3000;

// Create uploads directory if it doesn't exist
const uploadDir = path.join(__dirname, '../frontend/uploads');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

// Configure multer for file uploads
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, uploadDir)
    },
    filename: function (req, file, cb) {
        const unique = Date.now() + '-' + Math.round(Math.random() * 1E9);
        const ext = path.extname(file.originalname);
        cb(null, 'product-' + unique + ext);
    }
});

const upload = multer({ 
    storage: storage,
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        if (file.mimetype.startsWith('image/')) {
            cb(null, true);
        } else {
            cb(new Error('Only images allowed'));
        }
    }
});

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../frontend')));

// Database setup
const db = new sqlite3.Database(path.join(__dirname, 'database.db'));

// Create tables ONLY - NO SAMPLE PRODUCTS
db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS products (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        price REAL NOT NULL,
        category TEXT,
        image TEXT
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS orders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        order_number TEXT UNIQUE,
        items TEXT,
        total REAL,
        customer_name TEXT,
        payment_method TEXT,
        status TEXT DEFAULT 'pending',
        qr_code TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
});

// ========== API ROUTES ==========

// Get all products
app.get('/api/products', (req, res) => {
    db.all("SELECT * FROM products ORDER BY category", [], (err, rows) => {
        res.json(rows);
    });
});

// Get unique categories
app.get('/api/categories', (req, res) => {
    db.all("SELECT DISTINCT category FROM products ORDER BY category", [], (err, rows) => {
        res.json(rows.map(r => r.category));
    });
});

// Add product with image upload
app.post('/api/products', upload.single('image'), (req, res) => {
    const { name, price, category } = req.body;
    let imagePath = '/uploads/placeholder.jpg';
    
    if (req.file) {
        imagePath = '/uploads/' + req.file.filename;
    }
    
    db.run(
        "INSERT INTO products (name, price, category, image) VALUES (?, ?, ?, ?)",
        [name, price, category, imagePath],
        function(err) {
            res.json({ 
                id: this.lastID, 
                name, 
                price, 
                category, 
                image: imagePath 
            });
        }
    );
});

// Delete product
app.delete('/api/products/:id', (req, res) => {
    db.get("SELECT image FROM products WHERE id = ?", [req.params.id], (err, row) => {
        if (row && row.image && row.image !== '/uploads/placeholder.jpg') {
            const filePath = path.join(__dirname, '../frontend', row.image);
            if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
            }
        }
        
        db.run("DELETE FROM products WHERE id = ?", [req.params.id], function(err) {
            res.json({ deleted: true });
        });
    });
});

// Update product
app.put('/api/products/:id', upload.single('image'), (req, res) => {
    const { name, price, category } = req.body;
    let imagePath = req.body.existingImage;
    
    if (req.file) {
        imagePath = '/uploads/' + req.file.filename;
        if (req.body.existingImage && req.body.existingImage !== '/uploads/placeholder.jpg') {
            const oldPath = path.join(__dirname, '../frontend', req.body.existingImage);
            if (fs.existsSync(oldPath)) {
                fs.unlinkSync(oldPath);
            }
        }
    }
    
    db.run(
        "UPDATE products SET name=?, price=?, category=?, image=? WHERE id=?",
        [name, price, category, imagePath, req.params.id],
        function(err) {
            res.json({ updated: true, image: imagePath });
        }
    );
});

// Create order
app.post('/api/orders', async (req, res) => {
    const { items, total, customer_name, payment_method } = req.body;
    const order_number = 'ORD' + Date.now();
    const qr = await QRCode.toDataURL(order_number);
    
    db.run(
        "INSERT INTO orders (order_number, items, total, customer_name, payment_method, qr_code) VALUES (?, ?, ?, ?, ?, ?)",
        [order_number, JSON.stringify(items), total, customer_name, payment_method, qr],
        function(err) {
            res.json({ order_number, qr_code: qr });
        }
    );
});

// Get all orders
app.get('/api/orders', (req, res) => {
    db.all("SELECT * FROM orders ORDER BY created_at DESC", [], (err, rows) => {
        res.json(rows);
    });
});

// Update order status
app.put('/api/orders/:id', (req, res) => {
    const { status } = req.body;
    db.run("UPDATE orders SET status=? WHERE id=?", [status, req.params.id], function(err) {
        res.json({ updated: true });
    });
});

// Get single order
app.get('/api/orders/:order_number', (req, res) => {
    db.get("SELECT * FROM orders WHERE order_number = ?", [req.params.order_number], (err, row) => {
        res.json(row);
    });
});

// Admin login
app.post('/api/admin/login', (req, res) => {
    const { user, pass } = req.body;
    if (user === 'admin' && pass === 'admin123') {
        res.json({ success: true });
    } else {
        res.json({ success: false });
    }
});

// Serve pages
app.get('/', (req, res) => res.sendFile(path.join(__dirname, '../frontend/index.html')));
app.get('/cart', (req, res) => res.sendFile(path.join(__dirname, '../frontend/cart.html')));
app.get('/checkout', (req, res) => res.sendFile(path.join(__dirname, '../frontend/checkout.html')));
app.get('/ticket', (req, res) => res.sendFile(path.join(__dirname, '../frontend/ticket.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, '../frontend/admin/login.html')));
app.get('/admin/dashboard', (req, res) => res.sendFile(path.join(__dirname, '../frontend/admin/dashboard.html')));

app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running at http://localhost:${PORT}`);
    console.log(`Admin login: http://localhost:${PORT}/admin`);
});