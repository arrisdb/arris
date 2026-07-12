// Canonical sample dataset (shared across every docker-compose engine)
// Same collections, same _id keys, same documents everywhere so cross-source
// federated joins line up.

db = db.getSiblingDB("appdb");

// -----------------------------------------------------------------
// customers (12 documents)
// -----------------------------------------------------------------
db.customers.insertMany([
  { _id: 1,  first_name: "Ada",       last_name: "Lovelace",     email: "ada@example.com",       country_code: "GB", signup_date: ISODate("2025-01-01"), updated_at: ISODate("2025-01-01T09:00:00Z") },
  { _id: 2,  first_name: "Grace",     last_name: "Hopper",       email: "grace@example.com",     country_code: "US", signup_date: ISODate("2025-01-02"), updated_at: ISODate("2025-01-02T09:00:00Z") },
  { _id: 3,  first_name: "Katherine", last_name: "Johnson",      email: "katherine@example.com", country_code: "US", signup_date: ISODate("2025-01-03"), updated_at: ISODate("2025-01-03T09:00:00Z") },
  { _id: 4,  first_name: "Radia",     last_name: "Perlman",      email: "radia@example.com",     country_code: "CA", signup_date: ISODate("2025-01-04"), updated_at: ISODate("2025-01-04T09:00:00Z") },
  { _id: 5,  first_name: "Margaret",  last_name: "Hamilton",     email: "margaret@example.com",  country_code: "US", signup_date: ISODate("2025-01-05"), updated_at: ISODate("2025-01-05T09:00:00Z") },
  { _id: 6,  first_name: "Barbara",   last_name: "Liskov",       email: "barbara@example.com",   country_code: "US", signup_date: ISODate("2025-01-06"), updated_at: ISODate("2025-01-06T09:00:00Z") },
  { _id: 7,  first_name: "Joan",      last_name: "Clarke",       email: "joan@example.com",      country_code: "GB", signup_date: ISODate("2025-01-07"), updated_at: ISODate("2025-01-07T09:00:00Z") },
  { _id: 8,  first_name: "Karen",     last_name: "Sparck-Jones", email: "karen@example.com",     country_code: "GB", signup_date: ISODate("2025-01-08"), updated_at: ISODate("2025-01-08T09:00:00Z") },
  { _id: 9,  first_name: "Shafi",     last_name: "Goldwasser",   email: "shafi@example.com",     country_code: "US", signup_date: ISODate("2025-01-09"), updated_at: ISODate("2025-01-09T09:00:00Z") },
  { _id: 10, first_name: "Frances",   last_name: "Allen",        email: "frances@example.com",   country_code: "CA", signup_date: ISODate("2025-01-10"), updated_at: ISODate("2025-01-10T09:00:00Z") },
  { _id: 11, first_name: "Lynn",      last_name: "Conway",       email: "lynn@example.com",      country_code: "AU", signup_date: ISODate("2025-01-11"), updated_at: ISODate("2025-01-11T09:00:00Z") },
  { _id: 12, first_name: "Sophie",    last_name: "Wilson",       email: "sophie@example.com",    country_code: "DE", signup_date: ISODate("2025-01-12"), updated_at: ISODate("2025-01-12T09:00:00Z") },
]);

// -----------------------------------------------------------------
// products (8 documents)
// -----------------------------------------------------------------
db.products.insertMany([
  { _id: 1, product_name: "Mechanical Keyboard",         category: "Peripherals", price: 129.00 },
  { _id: 2, product_name: "Wireless Mouse",              category: "Peripherals", price: 49.00 },
  { _id: 3, product_name: "USB-C Hub",                   category: "Accessories", price: 35.00 },
  { _id: 4, product_name: "27in Monitor",               category: "Displays",    price: 299.00 },
  { _id: 5, product_name: "Laptop Stand",               category: "Accessories", price: 42.00 },
  { _id: 6, product_name: "Webcam 1080p",               category: "Peripherals", price: 69.00 },
  { _id: 7, product_name: "Noise-Cancelling Headphones", category: "Audio",      price: 199.00 },
  { _id: 8, product_name: "Desk Mat",                   category: "Accessories", price: 19.00 },
]);

// -----------------------------------------------------------------
// orders (30 documents)
// -----------------------------------------------------------------
db.orders.insertMany([
  { _id: 100, customer_id: 1,  order_date: ISODate("2025-01-03"), status: "completed", amount: 129.00 },
  { _id: 101, customer_id: 1,  order_date: ISODate("2025-01-15"), status: "shipped",   amount: 49.00 },
  { _id: 102, customer_id: 2,  order_date: ISODate("2025-01-04"), status: "completed", amount: 299.00 },
  { _id: 103, customer_id: 3,  order_date: ISODate("2025-01-05"), status: "pending",   amount: 35.00 },
  { _id: 104, customer_id: 4,  order_date: ISODate("2025-01-06"), status: "returned",  amount: 42.00 },
  { _id: 105, customer_id: 5,  order_date: ISODate("2025-01-07"), status: "completed", amount: 69.00 },
  { _id: 106, customer_id: 6,  order_date: ISODate("2025-01-08"), status: "completed", amount: 199.00 },
  { _id: 107, customer_id: 7,  order_date: ISODate("2025-01-09"), status: "shipped",   amount: 19.00 },
  { _id: 108, customer_id: 2,  order_date: ISODate("2025-01-12"), status: "completed", amount: 129.00 },
  { _id: 109, customer_id: 8,  order_date: ISODate("2025-01-14"), status: "cancelled", amount: 49.00 },
  { _id: 110, customer_id: 9,  order_date: ISODate("2025-01-16"), status: "completed", amount: 299.00 },
  { _id: 111, customer_id: 10, order_date: ISODate("2025-01-18"), status: "shipped",   amount: 35.00 },
  { _id: 112, customer_id: 11, order_date: ISODate("2025-01-20"), status: "completed", amount: 42.00 },
  { _id: 113, customer_id: 12, order_date: ISODate("2025-01-22"), status: "pending",   amount: 69.00 },
  { _id: 114, customer_id: 1,  order_date: ISODate("2025-01-25"), status: "completed", amount: 199.00 },
  { _id: 115, customer_id: 3,  order_date: ISODate("2025-01-27"), status: "completed", amount: 19.00 },
  { _id: 116, customer_id: 5,  order_date: ISODate("2025-02-01"), status: "shipped",   amount: 129.00 },
  { _id: 117, customer_id: 6,  order_date: ISODate("2025-02-03"), status: "completed", amount: 49.00 },
  { _id: 118, customer_id: 7,  order_date: ISODate("2025-02-05"), status: "returned",  amount: 299.00 },
  { _id: 119, customer_id: 9,  order_date: ISODate("2025-02-07"), status: "completed", amount: 35.00 },
  { _id: 120, customer_id: 2,  order_date: ISODate("2025-02-09"), status: "completed", amount: 42.00 },
  { _id: 121, customer_id: 4,  order_date: ISODate("2025-02-11"), status: "shipped",   amount: 69.00 },
  { _id: 122, customer_id: 8,  order_date: ISODate("2025-02-13"), status: "completed", amount: 199.00 },
  { _id: 123, customer_id: 10, order_date: ISODate("2025-02-15"), status: "pending",   amount: 19.00 },
  { _id: 124, customer_id: 11, order_date: ISODate("2025-02-17"), status: "completed", amount: 129.00 },
  { _id: 125, customer_id: 12, order_date: ISODate("2025-02-19"), status: "shipped",   amount: 49.00 },
  { _id: 126, customer_id: 1,  order_date: ISODate("2025-02-21"), status: "completed", amount: 299.00 },
  { _id: 127, customer_id: 5,  order_date: ISODate("2025-02-23"), status: "cancelled", amount: 35.00 },
  { _id: 128, customer_id: 6,  order_date: ISODate("2025-02-25"), status: "completed", amount: 42.00 },
  { _id: 129, customer_id: 3,  order_date: ISODate("2025-02-27"), status: "completed", amount: 69.00 },
]);

// -----------------------------------------------------------------
// order_items (37 documents)
// -----------------------------------------------------------------
db.order_items.insertMany([
  { _id: 1,  order_id: 100, product_id: 1, quantity: 1, unit_price: 129.00 },
  { _id: 2,  order_id: 101, product_id: 2, quantity: 1, unit_price: 49.00 },
  { _id: 3,  order_id: 102, product_id: 4, quantity: 1, unit_price: 299.00 },
  { _id: 4,  order_id: 103, product_id: 3, quantity: 1, unit_price: 35.00 },
  { _id: 5,  order_id: 104, product_id: 5, quantity: 1, unit_price: 42.00 },
  { _id: 6,  order_id: 105, product_id: 6, quantity: 1, unit_price: 69.00 },
  { _id: 7,  order_id: 106, product_id: 7, quantity: 1, unit_price: 199.00 },
  { _id: 8,  order_id: 107, product_id: 8, quantity: 1, unit_price: 19.00 },
  { _id: 9,  order_id: 108, product_id: 1, quantity: 1, unit_price: 129.00 },
  { _id: 10, order_id: 109, product_id: 2, quantity: 1, unit_price: 49.00 },
  { _id: 11, order_id: 110, product_id: 4, quantity: 1, unit_price: 299.00 },
  { _id: 12, order_id: 111, product_id: 3, quantity: 1, unit_price: 35.00 },
  { _id: 13, order_id: 112, product_id: 5, quantity: 1, unit_price: 42.00 },
  { _id: 14, order_id: 113, product_id: 6, quantity: 1, unit_price: 69.00 },
  { _id: 15, order_id: 114, product_id: 7, quantity: 1, unit_price: 199.00 },
  { _id: 16, order_id: 115, product_id: 8, quantity: 1, unit_price: 19.00 },
  { _id: 17, order_id: 116, product_id: 1, quantity: 1, unit_price: 129.00 },
  { _id: 18, order_id: 117, product_id: 2, quantity: 1, unit_price: 49.00 },
  { _id: 19, order_id: 118, product_id: 4, quantity: 1, unit_price: 299.00 },
  { _id: 20, order_id: 119, product_id: 3, quantity: 1, unit_price: 35.00 },
  { _id: 21, order_id: 120, product_id: 5, quantity: 1, unit_price: 42.00 },
  { _id: 22, order_id: 121, product_id: 6, quantity: 1, unit_price: 69.00 },
  { _id: 23, order_id: 122, product_id: 7, quantity: 1, unit_price: 199.00 },
  { _id: 24, order_id: 123, product_id: 8, quantity: 1, unit_price: 19.00 },
  { _id: 25, order_id: 124, product_id: 1, quantity: 1, unit_price: 129.00 },
  { _id: 26, order_id: 125, product_id: 2, quantity: 1, unit_price: 49.00 },
  { _id: 27, order_id: 126, product_id: 4, quantity: 1, unit_price: 299.00 },
  { _id: 28, order_id: 127, product_id: 3, quantity: 1, unit_price: 35.00 },
  { _id: 29, order_id: 128, product_id: 5, quantity: 1, unit_price: 42.00 },
  { _id: 30, order_id: 129, product_id: 6, quantity: 1, unit_price: 69.00 },
  { _id: 31, order_id: 100, product_id: 8, quantity: 2, unit_price: 19.00 },
  { _id: 32, order_id: 102, product_id: 2, quantity: 1, unit_price: 49.00 },
  { _id: 33, order_id: 106, product_id: 3, quantity: 1, unit_price: 35.00 },
  { _id: 34, order_id: 110, product_id: 5, quantity: 2, unit_price: 42.00 },
  { _id: 35, order_id: 114, product_id: 8, quantity: 1, unit_price: 19.00 },
  { _id: 36, order_id: 122, product_id: 2, quantity: 1, unit_price: 49.00 },
  { _id: 37, order_id: 126, product_id: 1, quantity: 1, unit_price: 129.00 },
]);

// -----------------------------------------------------------------
// sales_transactions (1M documents) — for chart / board testing
// -----------------------------------------------------------------
const regions  = ["North", "South", "East", "West", "Central"];
const categories = ["Electronics", "Clothing", "Food", "Furniture", "Sports", "Books", "Beauty", "Toys"];
const products = [
  "Laptop", "Phone", "Tablet", "Headphones", "Speaker",
  "T-Shirt", "Jeans", "Jacket", "Sneakers", "Hat",
  "Coffee", "Pasta", "Snacks", "Juice", "Bread",
  "Desk", "Chair", "Lamp", "Shelf", "Rug",
  "Basketball", "Yoga Mat", "Dumbbells", "Bike", "Helmet",
  "Novel", "Textbook", "Comic", "Magazine", "Planner",
  "Moisturizer", "Shampoo", "Perfume", "Lipstick", "Sunscreen",
  "Lego Set", "Board Game", "Puzzle", "Doll", "RC Car",
];
const channels = ["Online", "In-Store", "Wholesale", "Marketplace"];
const segments = ["Consumer", "Business", "Enterprise", "Government"];

const BATCH = 10000;
const TOTAL = 1000000;
const BASE_DATE = new Date("2023-01-01").getTime();
const DAY_MS = 86400000;

function round2(n) { return Math.round(n * 100) / 100; }

for (let start = 0; start < TOTAL; start += BATCH) {
  const batch = [];
  for (let j = 0; j < BATCH; j++) {
    const i = start + j;
    const q = 1 + Math.floor(Math.random() * 10);
    const p = round2(5 + Math.random() * 495);
    const amount = round2(q * p);
    batch.push({
      _id: i + 1,
      sale_date:         new Date(BASE_DATE + Math.floor(Math.random() * 912) * DAY_MS),
      region:            regions[i % 5],
      category:          categories[i % 8],
      product:           products[i % 40],
      channel:           channels[Math.floor(i / 5) % 4],
      customer_segment:  segments[Math.floor(i / 20) % 4],
      quantity:          q,
      unit_price:        p,
      amount:            amount,
      cost:              round2(amount * (0.4 + Math.random() * 0.3)),
      profit:            round2(amount * (0.3 + Math.random() * 0.3)),
    });
  }
  db.sales_transactions.insertMany(batch, { ordered: false });
}

db.sales_transactions.createIndex({ sale_date: 1 });
db.sales_transactions.createIndex({ region: 1 });
db.sales_transactions.createIndex({ category: 1 });

// -----------------------------------------------------------------
// events_10m (10M documents) - streaming-ingest perf testing.
// Schema matches the mysql/starrocks/clickhouse `events_10m` fixture.
// -----------------------------------------------------------------
const eventTypes = ["view", "click", "purchase", "signup", "logout", "share"];
const devices    = ["ios", "android", "web", "desktop"];
const countries  = ["US", "UK", "Canada", "Germany", "France", "Japan", "Australia", "Brazil", "India", "Mexico"];

const EVENTS_TOTAL = 10000000;
const EVENTS_BASE_DATE = new Date("2024-01-01").getTime();
const YEAR_MS = 31536000000;

for (let start = 0; start < EVENTS_TOTAL; start += BATCH) {
  const batch = [];
  for (let j = 0; j < BATCH; j++) {
    const i = start + j;
    batch.push({
      _id:        i + 1,
      user_id:    (Math.floor(Math.random() * 1000000)) + 1,
      event_type: eventTypes[Math.floor(Math.random() * eventTypes.length)],
      event_time: new Date(EVENTS_BASE_DATE + Math.floor(Math.random() * YEAR_MS)),
      device:     devices[Math.floor(Math.random() * devices.length)],
      country:    countries[Math.floor(Math.random() * countries.length)],
      amount:     round2(Math.random() * 1000),
    });
  }
  db.events_10m.insertMany(batch, { ordered: false });
}

print("MongoDB sample data seeded: appdb");
