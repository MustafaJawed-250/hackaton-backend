const express = require('express');
const rateLimit = require('express-rate-limit');
const { authenticate, requirePasswordChanged } = require('../middleware/auth');
const aiService = require('../services/aiService');

const router = express.Router();

const aiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: Number(process.env.AI_RATE_LIMIT_PER_MIN) || 20,
  message: { success: false, message: 'Too many AI requests, please wait a minute' },
});

router.use(authenticate, requirePasswordChanged, aiLimiter);

router.post('/chat', async (req, res, next) => {
  try {
    const messages = req.body.messages || [];
    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ success: false, message: 'messages array required' });
    }
    // Only keep role + content
    const safeMessages = messages
      .filter((m) => m.role && m.content)
      .map((m) => ({ role: m.role, content: String(m.content).slice(0, 4000) }))
      .slice(-10);

    const result = await aiService.chat(req.user, safeMessages);
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
