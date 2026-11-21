# Budget

Household budget for a phone browser and a desktop browser. It keeps budget plans, bank and card transactions, SWICA refunds, and shop receipts in MariaDB.

Sign in with your email. The first start creates an administrator for `rene@rene-unternaehrer.ch`. The password is written once to `data/admin-password.txt` inside the app data folder. Changing that file later does not change the password. An administrator can set a new password for any user under Users.

## What you can do

- Register with first name, last name, email, and password.
- Ask for a password-reset email when SMTP is configured. Until then, an administrator sets the new password.
- Enter budget rows: first pay date, how often, how many times or an end date, description, contact, amount, currency, CHF amount and rate, who it is for, category, and a yearly increase. Search and edit the list.
- Build a budget list for a number of days, such as 360 or 720, from a starting CHF amount. Export it to Excel. Match rows to real transactions automatically, or search and choose them.
- Import bank files (UBS CSV, Revolut CSV, Raiffeisen PDF) and card files (Viseca CSV, Swisscard CSV/Excel, Liberty Excel, UBS Visa CSV/PDF). Rows already stored are skipped, including when two downloads cover the same dates.
- Categorise each booking. Similar descriptions can reuse a category. Analysis sums spending by category, month, and source.
- Import a SWICA Leistungsabrechnung and line it up with the bank credit. Scans without text can be filled in by hand.
- Import Migros receipt PDFs, or a JPG or PNG photo of a paper receipt. Items keep description, quantity, weight, price, and an expiry date you can edit. A receipt can be linked to the card or bank payment. Photos are read automatically; check the lines afterwards.
- Inventory, next to Healthcare, lists what is still in the house. Change the expiry, weight, price per kilo, store, and where it is kept, and mark an item used up when it is finished.

Amounts in EUR or USD are shown next to the CHF amount and the rate. If the bank file contains the rate, that rate is kept. Otherwise set the rate under Settings and it fills transactions that do not have a CHF amount yet.

## Run with Docker on a Raspberry Pi 5

Install Docker, then from this folder:

```sh
cp .env.example .env
```

Edit `.env` before the first start. Set `DATABASE_URL` to the MariaDB already running on the Pi, with its own database and user. Set `JWT_SECRET` and `ADMIN_INITIAL_PASSWORD`. Set `APP_URL` to the address you open in the browser, for example `http://192.168.1.20:82`, so password links point at the Pi. The site listens on port 82 so it can sit beside another app on ports 80 and 443.

```sh
docker compose up -d --build
```

Open port 82. Later updates:

```sh
git pull
docker compose up -d --build
```

`scripts/update.sh` does those two steps. The database stays in the MariaDB already installed on the Pi. Uploaded files stay in a Docker volume.

To send password-reset email, set `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, and `SMTP_FROM`. Use `COOKIE_SECURE=1` only when the site is served over HTTPS.

## Develop on this computer

The app expects MariaDB. A private database for this project can listen on port 3307 so it does not use any other MariaDB already installed. `DATABASE_URL` in `.env` points there.

```sh
npm install
npm run dev
```

The site is at http://localhost:5173 and the API at port 3001. `npm run check` reads the sample files in `resources` and checks that the importers recognise them.

On this Windows machine a private MariaDB already lives in `.localdb` and listens on port 3307 (user `budget`, password `budget-local`, database `budget`). Start it before `npm run dev`:

```powershell
& "C:\Program Files\MariaDB 12.2\bin\mariadbd.exe" --defaults-file=".localdb\my.ini" --port=3307 --bind-address=127.0.0.1
```
