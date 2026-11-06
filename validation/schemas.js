import { z } from 'zod';

export const registerSchema = z.object({
  name: z.string().trim().min(2, 'Имя — минимум 2 символа').max(100, 'Имя — максимум 100 символов'),
  email: z.string().trim().toLowerCase().email('Некорректный e-mail'),
  password: z.string().min(8, 'Пароль — минимум 8 символов').max(72, 'Пароль — максимум 72 символа'),
});

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email('Некорректный e-mail'),
  password: z.string().min(1, 'Пароль обязателен').max(72, 'Пароль — максимум 72 символа'),
});

export const productSchema = z.object({
  name: z.string().trim().min(2, 'Название — минимум 2 символа').max(200, 'Название — максимум 200 символов'),
  price: z.coerce.number().positive('Цена должна быть больше 0').max(10_000_000, 'Цена не может превышать 10 000 000'),
  category: z.string().trim().min(1, 'Категория не должна быть пустой').max(50).optional().nullable(),
  unit: z.string().trim().min(1).max(20).optional().nullable(),
  image: z.string().trim().max(500).optional().nullable(),
});

// для PATCH/PUT: все поля необязательны, но хотя бы одно должно быть
export const productUpdateSchema = productSchema
  .partial()
  .refine((d) => Object.keys(d).length > 0, 'Нет полей для обновления');
