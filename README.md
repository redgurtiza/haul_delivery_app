# Haul backend (Node + Express + SQLite)

Roles: **client**, **driver**, **admin**. JWT auth, SQLite storage, live tracking over Server-Sent Events.

## Run
```bash
npm install
cp .env.example .env        # then edit JWT_SECRET, ADMIN_EMAIL, ADMIN_PASSWORD
set -a; . ./.env; set +a    # or: node --env-file=.env src/server.js  (Node 20.6+)
npm run seed                # optional demo users (password: Password123!)
npm start                   # http://localhost:3000/health
```
An admin account is created automatically on first start from `ADMIN_EMAIL` / `ADMIN_PASSWORD`.

## Web app
`public/index.html` is a single-page app for all three roles (login decides which screens you see). Express serves it, so after `npm start` just open **http://localhost:3000**. It uses Leaflet + OpenStreetMap tiles, Nominatim for address search, and the browser GPS for drivers (GPS needs HTTPS on phones, except on localhost).

## Order flow
`AWAITING_PAYMENT → PENDING → ASSIGNED → PICKED_UP → IN_TRANSIT → DELIVERED` (or `CANCELLED`)

1. Client: `POST /api/quote` (re-call with `priority:true/false` for the payment page) → `POST /api/orders` → `POST /api/orders/:id/pay`
   - The pay response is the **token**: `{orderId, estPickup, estDelivery, total}`.
2. Admin assigns a driver (`/api/admin/orders/:id/assign`), reorders the queue (`/move`).
3. Driver updates status and posts GPS; the client tracks via `/track` (snapshot) and `/stream` (live).

## Endpoints
| Who | Method & path | Purpose |
|---|---|---|
| public | `POST /api/auth/register` `/login`, `GET /api/auth/me` | clients sign up; everyone logs in |
| client | `POST /api/quote`, `POST /api/orders`, `GET /api/orders`, `GET /api/orders/:id` | quote, create, list, view |
| client | `POST /api/orders/:id/pay` `/cancel` | payment (GCash, Card, Bank Transfer, COD), cancel |
| client/admin/driver | `GET /api/orders/:id/track`, `GET /api/orders/:id/stream?token=JWT` | tracking snapshot / live events (`status`, `location`) |
| driver | `GET /api/driver/jobs` `/history`, `PATCH /api/driver/availability` | job list, on/off duty |
| driver | `POST /api/driver/location`, `POST /api/driver/orders/:id/status` | GPS ping; PICKED_UP → IN_TRANSIT → DELIVERED |
| admin | `GET /api/admin/stats`, `GET /api/admin/orders[?scope=all\|status=]` | dashboard, dispatch queue (priority first) |
| admin | `POST /api/admin/orders/:id/assign` `/move`, `PATCH .../status` | assign driver, reorder, override status |
| admin | `GET /api/admin/clients[/:id]` | client list + order history |
| admin | `GET/POST /api/admin/drivers`, `PATCH /api/admin/users/:id/active` | manage drivers / disable accounts |
| admin | `GET/PUT /api/admin/settings` | edit pricing (priority rate locked to 10–15%) |

## Example
```bash
TOKEN=$(curl -s localhost:3000/api/auth/login -H 'content-type: application/json' \
  -d '{"email":"maria@example.com","password":"Password123!"}' | node -pe 'JSON.parse(require("fs").readFileSync(0)).token')
curl -s localhost:3000/api/quote -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' -d '{
 "pickup":{"name":"Burnham Park","lat":16.4112,"lng":120.5931},
 "dropoff":{"name":"BSU La Trinidad","lat":16.45,"lng":120.588},
 "package":{"length":30,"width":20,"height":20,"weightKg":8},"priority":true}'
```
Frontend live tracking: `new EventSource('/api/orders/HX-ABC123/stream?token=' + jwt)`.

## Before production
- Replace `chargeStub()` in `src/routes/client.js` with PayMongo/Xendit and confirm payments via webhook.
- Put it behind HTTPS, set a strong `JWT_SECRET` and a specific `CORS_ORIGIN`.
- Swap the in-memory login throttle for `express-rate-limit` + Redis if running multiple instances; move to PostgreSQL if you scale out.
- Use OSRM/OpenRouteService for real road distance instead of straight-line × 1.3.
