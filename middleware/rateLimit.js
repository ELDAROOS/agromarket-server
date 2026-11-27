import rateLimit from 'express-rate-limit';

export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,  // окно 15 минут
  limit: 10,                 // не больше 10 попыток с одного IP
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Слишком много попыток. Попробуйте через 15 минут' },
  skip: (req) => process.env.NODE_ENV === 'test' && req.headers['x-test-rate-limit'] !== 'true', // тесты ЛР8 не должны упираться в лимит
});
