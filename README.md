# KaamConnect v4.0 — India's Trusted Worker Marketplace

## 🚀 Quick Start

### 1. Install dependencies
```bash
npm install
```

### 2. Configure environment
```bash
cp .env.example .env
# Edit .env and set your MONGODB_URI and JWT_SECRET
```

### 3. Start the server
```bash
npm start        # production
npm run dev      # development with auto-reload
```

### 4. Open in browser
```
http://localhost:5000
```


## 🐛 Bugs Fixed in v4

1. **Critical**: `paymentRoutes.js` `/verify` endpoint was using MySQL `db.query()` syntax instead of Mongoose — completely rewritten with proper async/await Mongoose calls
2. **Missing** `.env.example` file added with all required environment variables  
3. **Duplicate** nested `kaamconnect/kaamconnect/` folder removed
4. Full UI/UX redesign with human-crafted aesthetics

## 📁 Project Structure
```
kaamconnect/
├── config/       # MongoDB connection
├── controllers/  # Route handlers
├── middleware/   # Auth middleware (JWT)
├── models/       # Mongoose schemas
├── public/       # Frontend HTML pages
├── routes/       # Express routers
├── server.js     # Main server entry
└── .env.example  # Environment template
```

## 🌍 Tech Stack
- **Backend**: Node.js + Express
- **Database**: MongoDB Atlas (Mongoose)
- **Auth**: JWT (jsonwebtoken)
- **Payments**: Razorpay
- **Real-time**: Socket.IO
- **AI Chat**: Claude claude-haiku-4-5-20251001 (optional)
