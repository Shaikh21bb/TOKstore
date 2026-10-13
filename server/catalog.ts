import seed from '../db/seed.json';

class ProductValidationError extends Error {}

const categories = new Set(['phones', 'cases', 'charging', 'audio', 'other']);
const payments = new Set(['cash', 'card', 'mixed']);
const encoder = new TextEncoder();

const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), {
  status,
  headers: {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  },
});

export function isAdmin(request: Request, env: any) {
  const user = request.headers.get('oai-authenticated-user-id');
  const email = request.headers.get('oai-authenticated-user-email')?.toLowerCase();
  const owner = env.ADMIN_EMAIL?.trim().toLowerCase();
  return Boolean(user && email && owner && email === owner);
}

function originAllowed(request: Request) {
  const origin = request.headers.get('Origin');
  return request.headers.get('Sec-Fetch-Site') !== 'cross-site' && Boolean(origin && origin === new URL(request.url).origin);
}

async function digest(value: string) {
  const bytes = await crypto.subtle.digest('SHA-256', encoder.encode(value));
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function randomToken() {
  return `${crypto.randomUUID().replaceAll('-', '')}${crypto.randomUUID().replaceAll('-', '')}`;
}

function normalizePhone(value: unknown) {
  const digits = String(value ?? '').replace(/\D/g, '');
  if (digits.length < 10 || digits.length > 15) throw new ProductValidationError('Укажи телефон: от 10 до 15 цифр');
  return digits;
}

async function body(request: Request, max = 1_000_000) {
  if (Number(request.headers.get('Content-Length')) > max) throw new ProductValidationError('Запрос слишком большой');
  const raw = await request.text();
  if (raw.length > max) throw new ProductValidationError('Запрос слишком большой');
  return JSON.parse(raw || '{}');
}

function addHours(hours: number) {
  return new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
}

async function ensureSeeded(db: any, env: any) {
  const marker = await db.prepare("SELECT value FROM catalog_settings WHERE key = 'seed-v1'").first();
  if (!marker) {
    const now = new Date().toISOString();
    await db.batch([
      ...seed.map((product) => db.prepare('INSERT OR IGNORE INTO catalog_items (id, data, published, version, updated_at) VALUES (?, ?, ?, 1, ?)').bind(product.id, JSON.stringify(product), 1, now)),
      db.prepare("INSERT OR IGNORE INTO catalog_settings (key, value) VALUES ('seed-v1', ?)").bind(now),
    ]);
  }

  const staff = await db.prepare("SELECT id FROM staff WHERE id = 'seller-demo'").first();
  const configuredPin = String(env.STAFF_PIN || '1234');
  const salt = 'tok-seller-demo';
  const pinHash = await digest(`${salt}:${configuredPin}`);
  if (!staff) {
    await db.prepare('INSERT INTO staff (id, name, role, pin_salt, pin_hash, active) VALUES (?, ?, ?, ?, ?, 1)')
      .bind('seller-demo', 'Продавец ТОК', 'seller', salt, pinHash).run();
  } else if (env.STAFF_PIN) {
    await db.prepare('UPDATE staff SET pin_hash = ? WHERE id = ?').bind(pinHash, 'seller-demo').run();
  }
}

const hydrate = (row: any) => ({
  ...JSON.parse(row.data),
  id: row.id,
  published: Boolean(row.published),
  version: row.version,
  updatedAt: row.updated_at,
});

async function createSession(db: any, table: 'client_sessions' | 'staff_sessions', idColumn: 'client_id' | 'staff_id', id: string, hours: number) {
  const token = randomToken();
  const tokenHash = await digest(token);
  await db.prepare(`INSERT INTO ${table} (token_hash, ${idColumn}, expires_at) VALUES (?, ?, ?)`)
    .bind(tokenHash, id, addHours(hours)).run();
  return token;
}

async function clientSession(request: Request, db: any) {
  const token = request.headers.get('Authorization')?.replace(/^Bearer\s+/i, '');
  if (!token) return null;
  const row = await db.prepare('SELECT c.* FROM client_sessions s JOIN clients c ON c.id = s.client_id WHERE s.token_hash = ? AND s.expires_at > ?')
    .bind(await digest(token), new Date().toISOString()).first();
  return row || null;
}

async function staffSession(request: Request, db: any) {
  const token = request.headers.get('Authorization')?.replace(/^Bearer\s+/i, '');
  if (!token) return null;
  const row = await db.prepare('SELECT st.* FROM staff_sessions s JOIN staff st ON st.id = s.staff_id WHERE s.token_hash = ? AND s.expires_at > ? AND st.active = 1')
    .bind(await digest(token), new Date().toISOString()).first();
  return row || null;
}

function safeClient(row: any) {
  return {
    id: row.id,
    phone: row.phone,
    fullName: row.full_name,
    bonusBalance: row.bonus_balance,
    registrationDate: row.registration_date,
    qrToken: row.qr_token,
  };
}

function validImage(image: string) {
  if (/^assets\/[a-z0-9-]+\.svg$/.test(image)) return true;
  if (image.length < 2048) {
    try {
      const url = new URL(image);
      if (url.protocol === 'https:' && !url.username && !url.password) return true;
    } catch {}
  }
  const match = image.match(/^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/);
  if (!match || image.length > 850_000) return false;
  try {
    const header = atob(match[2].slice(0, 24));
    return match[1] === 'png'
      ? header.startsWith('\x89PNG\r\n\x1a\n')
      : match[1] === 'jpeg'
        ? header.startsWith('\xff\xd8\xff')
        : header.startsWith('RIFF') && header.slice(8, 12) === 'WEBP';
  } catch {
    return false;
  }
}

export function validateProduct(input: any) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new ProductValidationError('Неверный формат товара');
  const text = (key: string, max: number, required = false) => {
    if (input[key] === undefined && !required) return '';
    if (typeof input[key] !== 'string') throw new ProductValidationError(`Неверное поле: ${key}`);
    const value = input[key].trim();
    if ((required && !value) || value.length > max) throw new ProductValidationError(`Проверь поле: ${key}`);
    return value;
  };
  const integer = (key: string, min: number, max: number, optional = false) => {
    if (optional && (input[key] === undefined || input[key] === null || input[key] === '')) return undefined;
    if (!Number.isSafeInteger(input[key]) || input[key] < min || input[key] > max) throw new ProductValidationError(`Проверь поле: ${key}`);
    return input[key];
  };
  const category = text('category', 20, true);
  if (!categories.has(category)) throw new ProductValidationError('Выбери категорию');
  const price = integer('price', 1, 10_000_000);
  const old = integer('old', 1, 10_000_000, true);
  if (old !== undefined && old <= price) throw new ProductValidationError('Старая цена должна быть выше новой');
  const costPrice = integer('costPrice', 0, 10_000_000, true);
  if (costPrice !== undefined && costPrice > price) throw new ProductValidationError('Закупочная цена не может быть выше розничной');
  const image = text('image', 850_000, true);
  if (!validImage(image)) throw new ProductValidationError('Фото: HTTPS-ссылка, стандартная иллюстрация или PNG/JPEG/WebP до 600 КБ');
  const specs = input.specs;
  if (!specs || typeof specs !== 'object' || Array.isArray(specs) || Object.keys(specs).length > 12) throw new ProductValidationError('Добавь не более 12 характеристик');
  const safeSpecs: Record<string, string> = Object.create(null);
  for (const [key, value] of Object.entries(specs)) {
    if (!key.trim() || key.length > 50 || typeof value !== 'string' || value.length > 160) throw new ProductValidationError('Проверь характеристики');
    safeSpecs[key.trim()] = value.trim();
  }
  if (typeof input.published !== 'boolean') throw new ProductValidationError('Проверь статус публикации');
  return {
    name: text('name', 120, true),
    brand: text('brand', 40, true),
    category,
    model: text('model', 80, true),
    price,
    costPrice,
    old,
    color: text('color', 100, true),
    image,
    desc: text('desc', 2000, true),
    badge: text('badge', 40),
    specs: safeSpecs,
    stock: integer('stock', 0, 100_000),
    minStock: integer('minStock', 0, 100_000, true) ?? 3,
    rank: integer('rank', 0, 100_000),
    published: input.published,
    colors: Array.isArray(input.colors) ? input.colors.slice(0, 8) : [],
  };
}

async function loyaltyLogin(request: Request, db: any) {
  const input = await body(request, 20_000);
  const phone = normalizePhone(input.phone);
  const pin = String(input.pin ?? '');
  if (!/^\d{4}$/.test(pin)) throw new ProductValidationError('Придумай 4-значный код доступа');
  let client = await db.prepare('SELECT * FROM clients WHERE phone = ?').bind(phone).first();
  if (client) {
    const candidate = await digest(`${client.pin_salt}:${pin}`);
    if (candidate !== client.pin_hash) return json({ error: 'Неверный телефон или код доступа' }, 401);
  } else {
    const fullName = String(input.fullName ?? '').trim();
    if (fullName.length < 2 || fullName.length > 80) throw new ProductValidationError('Укажи имя для новой карты');
    const id = `CL-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
    const salt = crypto.randomUUID();
    const now = new Date().toISOString();
    await db.prepare('INSERT INTO clients (id, phone, full_name, pin_salt, pin_hash, bonus_balance, registration_date, qr_token) VALUES (?, ?, ?, ?, ?, 0, ?, ?)')
      .bind(id, phone, fullName, salt, await digest(`${salt}:${pin}`), now, randomToken().slice(0, 24)).run();
    client = await db.prepare('SELECT * FROM clients WHERE id = ?').bind(id).first();
  }
  const token = await createSession(db, 'client_sessions', 'client_id', client.id, 24 * 30);
  return json({ token, client: safeClient(client), demoAuth: true });
}

async function loyaltyProfile(request: Request, db: any) {
  const client = await clientSession(request, db);
  if (!client) return json({ error: 'Войди в карту лояльности снова' }, 401);
  const orderRows = await db.prepare("SELECT * FROM orders WHERE client_id = ? AND status = 'completed' ORDER BY date_time DESC LIMIT 20").bind(client.id).all();
  const orders = [];
  for (const order of orderRows.results as any[]) {
    const itemRows = await db.prepare('SELECT product_name, quantity, price_at_sale, subtotal FROM order_items WHERE order_id = ? ORDER BY rowid').bind(order.id).all();
    orders.push({ id: order.id, dateTime: order.date_time, totalAmount: order.total_amount, bonusesSpent: order.bonuses_spent, bonusesEarned: order.bonuses_earned, paymentMethod: order.payment_method, items: itemRows.results });
  }
  return json({ client: safeClient(client), orders });
}

async function staffLogin(request: Request, db: any) {
  const input = await body(request, 10_000);
  const pin = String(input.pin ?? '');
  if (!/^\d{4}$/.test(pin)) throw new ProductValidationError('Введите 4 цифры PIN');
  const rows = await db.prepare('SELECT * FROM staff WHERE active = 1').all();
  let selected: any = null;
  for (const staff of rows.results as any[]) {
    if (await digest(`${staff.pin_salt}:${pin}`) === staff.pin_hash) selected = staff;
  }
  if (!selected) return json({ error: 'Неверный PIN сотрудника' }, 401);
  const token = await createSession(db, 'staff_sessions', 'staff_id', selected.id, 8);
  return json({ token, staff: { id: selected.id, name: selected.name, role: selected.role } });
}

async function posSale(request: Request, db: any) {
  const seller = await staffSession(request, db);
  if (!seller) return json({ error: 'Сессия кассира истекла. Войдите снова.' }, 401);
  const input = await body(request, 200_000);
  if (!Array.isArray(input.items) || !input.items.length || input.items.length > 50) throw new ProductValidationError('Добавьте товары в чек');
  if (!payments.has(input.paymentMethod)) throw new ProductValidationError('Выберите способ оплаты');

  const quantities = new Map<string, number>();
  for (const item of input.items) {
    const id = String(item.id ?? '');
    const quantity = Number(item.quantity);
    if (!/^[a-zA-Z0-9-]{1,80}$/.test(id) || !Number.isSafeInteger(quantity) || quantity < 1 || quantity > 99) throw new ProductValidationError('Проверьте товары в чеке');
    quantities.set(id, (quantities.get(id) || 0) + quantity);
  }

  const lines: Array<{ product: any; quantity: number; subtotal: number }> = [];
  for (const [id, quantity] of quantities) {
    const row = await db.prepare('SELECT * FROM catalog_items WHERE id = ? AND published = 1').bind(id).first();
    if (!row) throw new ProductValidationError('Один из товаров больше недоступен');
    const product = hydrate(row);
    if (product.stock < quantity) throw new ProductValidationError(`Недостаточно на складе: ${product.name}`);
    lines.push({ product, quantity, subtotal: product.price * quantity });
  }

  let client: any = null;
  if (input.clientPhone) client = await db.prepare('SELECT * FROM clients WHERE phone = ?').bind(normalizePhone(input.clientPhone)).first();
  const subtotal = lines.reduce((sum, line) => sum + line.subtotal, 0);
  const requestedBonuses = Number(input.bonusesSpent || 0);
  if (!Number.isSafeInteger(requestedBonuses) || requestedBonuses < 0) throw new ProductValidationError('Проверьте количество бонусов');
  const maxBonus = client ? Math.min(client.bonus_balance, Math.floor(subtotal * 0.3)) : 0;
  if (requestedBonuses > maxBonus) throw new ProductValidationError(`Можно списать не более ${maxBonus} бонусов`);
  const totalAmount = subtotal - requestedBonuses;
  const bonusesEarned = client ? Math.floor(totalAmount * 0.05) : 0;
  const now = new Date().toISOString();
  const orderId = `ORD-${now.slice(0, 10).replaceAll('-', '')}-${crypto.randomUUID().slice(0, 5).toUpperCase()}`;
  const statements = [
    db.prepare('INSERT INTO orders (id, date_time, client_id, total_amount, bonuses_spent, bonuses_earned, payment_method, seller_id, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(orderId, now, client?.id || null, totalAmount, requestedBonuses, bonusesEarned, input.paymentMethod, seller.id, 'completed'),
  ];
  for (const line of lines) {
    const nextProduct = { ...line.product, stock: line.product.stock - line.quantity };
    delete nextProduct.version;
    delete nextProduct.updatedAt;
    statements.push(db.prepare('INSERT INTO order_items (id, order_id, product_id, product_name, quantity, price_at_sale, cost_at_sale, subtotal) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(`ITEM-${crypto.randomUUID()}`, orderId, line.product.id, line.product.name, line.quantity, line.product.price, line.product.costPrice || 0, line.subtotal));
    statements.push(db.prepare('UPDATE catalog_items SET data = ?, version = version + 1, updated_at = ? WHERE id = ?')
      .bind(JSON.stringify(nextProduct), now, line.product.id));
  }
  if (client) statements.push(db.prepare('UPDATE clients SET bonus_balance = bonus_balance - ? + ? WHERE id = ?').bind(requestedBonuses, bonusesEarned, client.id));
  await db.batch(statements);
  return json({
    order: {
      id: orderId,
      dateTime: now,
      subtotal,
      totalAmount,
      bonusesSpent: requestedBonuses,
      bonusesEarned,
      paymentMethod: input.paymentMethod,
      client: client ? { ...safeClient(client), bonusBalance: client.bonus_balance - requestedBonuses + bonusesEarned } : null,
      items: lines.map((line) => ({ id: line.product.id, name: line.product.name, quantity: line.quantity, price: line.product.price, subtotal: line.subtotal })),
    },
  }, 201);
}

async function dashboard(db: any) {
  const ordersResult = await db.prepare("SELECT * FROM orders WHERE status = 'completed' ORDER BY date_time DESC").all();
  const itemsResult = await db.prepare('SELECT * FROM order_items').all();
  const productsResult = await db.prepare('SELECT * FROM catalog_items').all();
  const clientsCount = await db.prepare('SELECT COUNT(*) AS count FROM clients').first();
  const orders = ordersResult.results as any[];
  const items = itemsResult.results as any[];
  const products = (productsResult.results as any[]).map(hydrate);
  const now = new Date();
  const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const weekStart = new Date(dayStart); weekStart.setUTCDate(dayStart.getUTCDate() - 6);
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const revenueSince = (date: Date) => orders.filter((order) => new Date(order.date_time) >= date).reduce((sum, order) => sum + order.total_amount, 0);
  const daily = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(weekStart); date.setUTCDate(weekStart.getUTCDate() + index);
    const next = new Date(date); next.setUTCDate(date.getUTCDate() + 1);
    return { date: date.toISOString().slice(0, 10), label: new Intl.DateTimeFormat('ru-KZ', { weekday: 'short' }).format(date), value: orders.filter((order) => new Date(order.date_time) >= date && new Date(order.date_time) < next).reduce((sum, order) => sum + order.total_amount, 0) };
  });
  const top = new Map<string, { id: string; name: string; quantity: number; revenue: number }>();
  for (const item of items) {
    const current = top.get(item.product_id) || { id: item.product_id, name: item.product_name, quantity: 0, revenue: 0 };
    current.quantity += item.quantity;
    current.revenue += item.subtotal;
    top.set(item.product_id, current);
  }
  const average = orders.length ? Math.round(orders.reduce((sum, order) => sum + order.total_amount, 0) / orders.length) : 0;
  const grossProfit = items.reduce((sum, item) => sum + item.subtotal - item.cost_at_sale * item.quantity, 0);
  return {
    metrics: { day: revenueSince(dayStart), week: revenueSince(weekStart), month: revenueSince(monthStart), average, grossProfit, orders: orders.length, clients: Number(clientsCount?.count || 0) },
    daily,
    topProducts: [...top.values()].sort((a, b) => b.quantity - a.quantity).slice(0, 5),
    lowStock: products.filter((product) => product.stock <= (product.minStock ?? 3)).sort((a, b) => a.stock - b.stock).slice(0, 12),
    recentOrders: orders.slice(0, 8).map((order) => ({ id: order.id, dateTime: order.date_time, totalAmount: order.total_amount, paymentMethod: order.payment_method, bonusesSpent: order.bonuses_spent })),
    modules: { products: products.length, categories: new Set(products.map((product) => product.category)).size, clients: Number(clientsCount?.count || 0), orders: orders.length, orderItems: items.length, staff: 1 },
  };
}

export async function handleAPI(request: Request, env: any) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/$/, '');
  const method = request.method;

  if (path === '/api/me') return json({ admin: isAdmin(request, env), signedIn: Boolean(request.headers.get('oai-authenticated-user-id')) });
  if (!['GET', 'HEAD'].includes(method) && !originAllowed(request)) return json({ error: 'Запрос должен быть отправлен с сайта магазина' }, 403);
  if (!env.DB) return json({ error: 'Каталог временно недоступен. Попробуй позже.' }, 503);

  try {
    await ensureSeeded(env.DB, env);
    if (path === '/api/catalog' && method === 'GET') {
      const rows = await env.DB.prepare('SELECT * FROM catalog_items WHERE published = 1 ORDER BY id').all();
      return json({ products: rows.results.map(hydrate) });
    }
    if (path === '/api/loyalty/session' && method === 'POST') return loyaltyLogin(request, env.DB);
    if (path === '/api/loyalty/me' && method === 'GET') return loyaltyProfile(request, env.DB);
    if (path === '/api/pos/login' && method === 'POST') return staffLogin(request, env.DB);
    if (path === '/api/pos/products' && method === 'GET') {
      const staff = await staffSession(request, env.DB);
      if (!staff) return json({ error: 'Войдите по PIN сотрудника' }, 401);
      const rows = await env.DB.prepare('SELECT * FROM catalog_items WHERE published = 1 ORDER BY updated_at DESC').all();
      return json({ products: rows.results.map(hydrate), staff: { id: staff.id, name: staff.name, role: staff.role } });
    }
    if (path === '/api/pos/client' && method === 'GET') {
      if (!await staffSession(request, env.DB)) return json({ error: 'Войдите по PIN сотрудника' }, 401);
      const qr = url.searchParams.get('qr');
      const client = qr
        ? await env.DB.prepare('SELECT * FROM clients WHERE qr_token = ?').bind(qr).first()
        : await env.DB.prepare('SELECT * FROM clients WHERE phone = ?').bind(normalizePhone(url.searchParams.get('phone'))).first();
      return client ? json({ client: safeClient(client) }) : json({ error: 'Карта клиента не найдена' }, 404);
    }
    if (path === '/api/pos/sale' && method === 'POST') return posSale(request, env.DB);

    const adminPath = path.startsWith('/api/admin/');
    if (adminPath && !isAdmin(request, env)) return json({ error: 'Доступ к управлению есть только у владельца магазина' }, 403);
    if (path === '/api/admin/dashboard' && method === 'GET') return json(await dashboard(env.DB));
    if (path === '/api/admin/products' && method === 'GET') {
      const rows = await env.DB.prepare('SELECT * FROM catalog_items ORDER BY updated_at DESC, id').all();
      return json({ products: rows.results.map(hydrate) });
    }
    if (path === '/api/admin/products' && method === 'POST') {
      const product = validateProduct(await body(request));
      const id = `p-${crypto.randomUUID()}`;
      const now = new Date().toISOString();
      await env.DB.prepare('INSERT INTO catalog_items (id, data, published, version, updated_at) VALUES (?, ?, ?, 1, ?)').bind(id, JSON.stringify(product), product.published ? 1 : 0, now).run();
      return json({ product: { ...product, id, version: 1, updatedAt: now } }, 201);
    }
    const match = path.match(/^\/api\/admin\/products\/([a-zA-Z0-9-]{1,80})$/);
    if (match && ['PUT', 'DELETE'].includes(method)) {
      const input = await body(request);
      if (!Number.isSafeInteger(input.version) || input.version < 1) return json({ error: 'Нужна текущая версия товара' }, 400);
      const id = match[1];
      if (method === 'DELETE') {
        const result = await env.DB.prepare('DELETE FROM catalog_items WHERE id = ? AND version = ?').bind(id, input.version).run();
        if (!result.meta.changes) return json({ error: 'Товар уже изменён или удалён. Обнови каталог.' }, 409);
        return json({ deleted: true, id });
      }
      const product = validateProduct(input);
      const now = new Date().toISOString();
      const result = await env.DB.prepare('UPDATE catalog_items SET data = ?, published = ?, version = version + 1, updated_at = ? WHERE id = ? AND version = ?')
        .bind(JSON.stringify(product), product.published ? 1 : 0, now, id, input.version).run();
      if (!result.meta.changes) return json({ error: 'Товар уже изменён или удалён. Обнови каталог.' }, 409);
      return json({ product: { ...product, id, version: input.version + 1, updatedAt: now } });
    }
    return json({ error: 'Маршрут не найден' }, 404);
  } catch (error) {
    if (error instanceof SyntaxError) return json({ error: 'Неверный формат JSON' }, 400);
    if (error instanceof ProductValidationError) return json({ error: error.message }, 400);
    console.error(error);
    return json({ error: 'Не удалось выполнить операцию. Попробуйте позже.' }, 500);
  }
}
