// KaamConnect AI Chatbot - rule-based with optional Claude API
const { Message } = require("../models");

function getRuleBasedResponse(msg) {
  const m = msg.toLowerCase();
  if (["hello","hi","hey","namaste"].some(w=>m.includes(w)))
    return { response:"Namaste! 🙏 I'm KaamBot. How can I help you find a skilled worker today?", suggestions:["Find Electrician","How it works?","Pricing info"] };
  if (["how","book","hire","use"].some(w=>m.includes(w)))
    return { response:"Booking is easy! 1️⃣ Search by skill & city 2️⃣ Pick a verified worker 3️⃣ Confirm job 4️⃣ Pay after work done ✅", suggestions:["Find Workers","Register Now"] };
  if (["price","cost","charges","rate","kitna"].some(w=>m.includes(w)))
    return { response:"Prices vary by service:\n⚡ Electrician: ₹300–₹1500\n🔧 Plumber: ₹400–₹2000\n🎨 Painter: ₹500–₹5000\n🪚 Carpenter: ₹600–₹4000\n\nPlatform fee: 10% only.", suggestions:["Book Now","Compare Workers"] };
  if (["safe","verify","verified","trust"].some(w=>m.includes(w)))
    return { response:"All workers are admin-verified with background checks. ✅ Ratings & reviews from real customers. Secure Razorpay payments — released only after job done!", suggestions:["View profiles","How reviews work?"] };
  if (["pay","payment","upi","razorpay"].some(w=>m.includes(w)))
    return { response:"We support: 💳 Cards, 📱 UPI (GPay, PhonePe), 🏦 Net Banking via Razorpay. All encrypted & secure. Money released to worker only after completion.", suggestions:["Book a service","Payment safety"] };
  if (["cancel","refund"].some(w=>m.includes(w)))
    return { response:"Before acceptance: FREE cancellation ✅\nAfter acceptance: 10% fee\nRefunds in 3–5 days.\nNeed help? Contact support!", suggestions:["Contact Support"] };
  if (["register","sign up","join"].some(w=>m.includes(w)))
    return { response:"Join free! 🎉\nCustomers: Register → Book instantly\nWorkers: Register → Get verified → Start earning!\nClick Get Started to begin.", suggestions:["Register as Customer","Register as Worker"] };
  return {
    response:"I can help with: finding workers, booking, pricing, payments, safety & registration. What would you like to know? 😊",
    suggestions:["Find Workers","How it works?","Pricing","Safety"] 
  };
}

exports.chat = async (req, res) => {
  try {
    const { message, history = [] } = req.body;
    if (!message?.trim()) return res.status(400).json({ success: false, message: "Message required" });

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (apiKey && apiKey !== "your_anthropic_api_key_here") {
      try {
        const msgs = [...history.slice(-10), { role:"user", content:message }];
        const r = await fetch("https://api.anthropic.com/v1/messages", {
          method:"POST",
          headers:{ "Content-Type":"application/json","x-api-key":apiKey,"anthropic-version":"2023-06-01" },
          body:JSON.stringify({ model:"claude-haiku-4-5-20251001", max_tokens:400, system:"You are KaamBot, helper for KaamConnect — an Indian worker marketplace. Help users find electricians, plumbers, painters, carpenters etc. Be friendly, concise. Respond in user's language (English/Hindi/Hinglish).", messages:msgs })
        });
        if (r.ok) {
          const d = await r.json();
          return res.json({ success:true, response:d.content[0].text, suggestions:["Tell me more","Book a service"], source:"ai" });
        }
      } catch {}
    }

    const { response, suggestions } = getRuleBasedResponse(message);
    res.json({ success:true, response, suggestions, source:"rules" });
  } catch (err) {
    res.status(500).json({ success:false, message:"Chat service unavailable" });
  }
};

exports.getFAQs = (req, res) => {
  res.json({ success:true, faqs:[
    { q:"How do I book a worker?", a:"Search by skill & location, view profiles, click 'Hire Now'" },
    { q:"Are workers verified?", a:"Yes, admin-verified with background checks" },
    { q:"What payment methods work?", a:"UPI, Cards, Net Banking via Razorpay" },
    { q:"Can I cancel?", a:"Free before acceptance, 10% fee after" },
    { q:"How to register as worker?", a:"Register with role 'Worker', add skills, wait for admin verification" },
  ]});
};
