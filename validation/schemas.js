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
  price: z.coerce.number().int().positive('Цена должна быть больше 0').max(10_000_000, 'Цена не может превышать 10 000 000'),
  category: z.string().trim().min(1, 'Категория не должна быть пустой').max(50).optional().nullable(),
  unit: z.string().trim().min(1).max(20).optional().nullable(),
  image: z.string().trim().max(500).optional().nullable(),
  stock: z.number().int().min(0, 'Остаток не может быть отрицательным').max(2_147_483_647).optional(),
});

// для PATCH/PUT: все поля необязательны, но хотя бы одно должно быть
export const productUpdateSchema = productSchema
  .partial()
  .refine((d) => Object.keys(d).length > 0, 'Нет полей для обновления');

export const checkoutSchema = z.object({
  items: z.array(z.object({
    productId: z.number().int().positive().max(2_147_483_647),
    quantity: z.number().int().min(1).max(100),
  })).min(1, 'Корзина пуста').max(50),
  address: z.string().trim().min(5, 'Укажите адрес доставки').max(200),
}).superRefine(({ items }, ctx) => {
  const totals = new Map();
  for (const { productId, quantity } of items) {
    totals.set(productId, (totals.get(productId) ?? 0) + quantity);
  }
  if ([...totals.values()].some((quantity) => quantity > 100)) {
    ctx.addIssue({ code: 'custom', path: ['items'], message: 'Не больше 100 единиц одного товара' });
  }
});
