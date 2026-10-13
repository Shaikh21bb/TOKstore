import seed from '../db/seed.json';
class ProductValidationError extends Error {}
const categories=new Set(['phones','cases','charging','audio','other']);
const json=(value:any,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
export function isAdmin(request:Request,env:any){
 const user=request.headers.get('oai-authenticated-user-id');
 const email=request.headers.get('oai-authenticated-user-email')?.toLowerCase();
 const owner=env.ADMIN_EMAIL?.trim().toLowerCase();
 return !!user&&!!email&&!!owner&&email===owner;
}
function originAllowed(request:Request){
 const origin=request.headers.get('Origin');
 return request.headers.get('Sec-Fetch-Site')!=='cross-site'&&!!origin&&origin===new URL(request.url).origin;
}
function validImage(image:string){
 if(/^assets\/[a-z0-9-]+\.svg$/.test(image))return true;
 if(image.length<2048){try{const u=new URL(image);if(u.protocol==='https:'&&!u.username&&!u.password)return true}catch{}}
 const match=image.match(/^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/);
 if(!match||image.length>850000)return false;
 try{const header=atob(match[2].slice(0,24));return match[1]==='png'?header.startsWith('\x89PNG\r\n\x1a\n'):match[1]==='jpeg'?header.startsWith('\xff\xd8\xff'):header.startsWith('RIFF')&&header.slice(8,12)==='WEBP'}catch{return false}
}
export function validateProduct(input:any){
 if(!input||typeof input!=='object'||Array.isArray(input))throw new ProductValidationError('Неверный формат товара');
 const text=(key:string,max:number,required=false)=>{if(input[key]===undefined&&!required)return '';if(typeof input[key]!=='string')throw new ProductValidationError('Неверное поле: '+key);const value=input[key].trim();if((required&&!value)||value.length>max)throw new ProductValidationError('Проверь поле: '+key);return value};
 const integer=(key:string,min:number,max:number,optional=false)=>{if(optional&&(input[key]===undefined||input[key]===null||input[key]===''))return undefined;if(!Number.isSafeInteger(input[key])||input[key]<min||input[key]>max)throw new ProductValidationError('Проверь поле: '+key);return input[key]};
 const category=text('category',20,true);if(!categories.has(category))throw new ProductValidationError('Выбери категорию');
 const price=integer('price',1,10000000),old=integer('old',1,10000000,true);if(old!==undefined&&old<=price)throw new ProductValidationError('Старая цена должна быть выше новой');
 const image=text('image',850000,true);if(!validImage(image))throw new ProductValidationError('Фото: HTTPS-ссылка, стандартная иллюстрация или PNG/JPEG/WebP до 600 КБ');
 const specs=input.specs;if(!specs||typeof specs!=='object'||Array.isArray(specs)||Object.keys(specs).length>12)throw new ProductValidationError('Добавь не более 12 характеристик');
 const safeSpecs:Record<string,string>=Object.create(null);for(const [k,v] of Object.entries(specs)){if(!k.trim()||k.length>50||typeof v!=='string'||v.length>160)throw new ProductValidationError('Проверь характеристики');safeSpecs[k.trim()]=v.trim()}
 if(typeof input.published!=='boolean')throw new ProductValidationError('Проверь статус публикации');
 return {name:text('name',120,true),brand:text('brand',40,true),category,model:text('model',80,true),price,old,color:text('color',100,true),image,desc:text('desc',2000,true),badge:text('badge',40),specs:safeSpecs,stock:integer('stock',0,100000),rank:integer('rank',0,100000),published:input.published,colors:[]};
}
async function seeded(db:any){
 const marker=await db.prepare("SELECT value FROM catalog_settings WHERE key = 'seed-v1'").first();if(marker)return;
 const now=new Date().toISOString();
 await db.batch([...seed.map(p=>db.prepare('INSERT OR IGNORE INTO catalog_items (id, data, published, version, updated_at) VALUES (?, ?, ?, 1, ?)').bind(p.id,JSON.stringify(p),1,now)),db.prepare("INSERT OR IGNORE INTO catalog_settings (key, value) VALUES ('seed-v1', ?)").bind(now)]);
}
const hydrate=(r:any)=>({...JSON.parse(r.data),id:r.id,published:!!r.published,version:r.version,updatedAt:r.updated_at});
export async function handleAPI(request:Request,env:any){
 const path=new URL(request.url).pathname.replace(/\/$/,'');const method=request.method;
 if(path==='/api/me')return json({admin:isAdmin(request,env),signedIn:!!request.headers.get('oai-authenticated-user-id')});
 const adminPath=path.startsWith('/api/admin/');
 if(adminPath&&!isAdmin(request,env))return json({error:'Доступ к управлению есть только у владельца магазина'},403);
 if(!['GET','HEAD'].includes(method)&&!originAllowed(request))return json({error:'Запрос должен быть отправлен с сайта магазина'},403);
 if(!env.DB)return json({error:'Каталог временно недоступен. Попробуй позже.'},503);
 try{
  if(path==='/api/catalog'&&method==='GET'){
   await seeded(env.DB);const rows=await env.DB.prepare('SELECT * FROM catalog_items WHERE published = 1 ORDER BY id').all();return json({products:rows.results.map(hydrate)});
  }
  if(path==='/api/admin/products'&&method==='GET'){
   await seeded(env.DB);const rows=await env.DB.prepare('SELECT * FROM catalog_items ORDER BY updated_at DESC, id').all();return json({products:rows.results.map(hydrate)});
  }
  if(path==='/api/admin/products'&&method==='POST'){
   if(Number(request.headers.get('Content-Length'))>1000000)return json({error:'Фото слишком большое'},413);
   const raw=await request.text();if(raw.length>1000000)return json({error:'Фото слишком большое'},413);
   const product=validateProduct(JSON.parse(raw));const id='p-'+crypto.randomUUID(),now=new Date().toISOString();
   await env.DB.prepare('INSERT INTO catalog_items (id, data, published, version, updated_at) VALUES (?, ?, ?, 1, ?)').bind(id,JSON.stringify(product),product.published?1:0,now).run();return json({product:{...product,id,version:1,updatedAt:now}},201);
  }
  const match=path.match(/^\/api\/admin\/products\/([a-zA-Z0-9-]{1,80})$/);
  if(match&&['PUT','DELETE'].includes(method)){
   const raw=await request.text();if(raw.length>1000000)return json({error:'Фото слишком большое'},413);const input=JSON.parse(raw);
   if(!Number.isSafeInteger(input.version)||input.version<1)return json({error:'Нужна текущая версия товара'},400);
   const id=match[1];
   if(method==='DELETE'){
    const result=await env.DB.prepare('DELETE FROM catalog_items WHERE id = ? AND version = ?').bind(id,input.version).run();
    if(!result.meta.changes)return json({error:'Товар уже изменён или удалён. Обнови каталог.'},409);return json({deleted:true,id});
   }
   const product=validateProduct(input),now=new Date().toISOString();
   const result=await env.DB.prepare('UPDATE catalog_items SET data = ?, published = ?, version = version + 1, updated_at = ? WHERE id = ? AND version = ?').bind(JSON.stringify(product),product.published?1:0,now,id,input.version).run();
   if(!result.meta.changes)return json({error:'Товар уже изменён или удалён. Обнови каталог.'},409);return json({product:{...product,id,version:input.version+1,updatedAt:now}});
  }
  return json({error:'Маршрут не найден'},404);
 }catch(error){if(error instanceof SyntaxError)return json({error:'Неверный формат JSON'},400);if(error instanceof ProductValidationError)return json({error:error.message},400);return json({error:'Не удалось обновить каталог. Попробуй позже.'},500)}
}
