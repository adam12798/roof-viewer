# Setup Guide — Project Interrupt

Follow these steps to run this project on your personal computer.

---

## 1. Install Node.js

If you don't have Node.js installed, download and install it from:

**https://nodejs.org** — choose the LTS version.

Verify it's installed by opening your terminal and running:

```bash
node -v
npm -v
```

Both should print a version number.

---

## 2. Copy the project files

Copy the entire `project Interrupt` folder to your computer (USB drive, AirDrop, zip file, etc.).

---

## 3. Install dependencies

Open your terminal, navigate into the project folder, and run:

```bash
cd "project Interrupt"
npm install
```

This installs Express and the other packages listed in `package.json`.

---

## 4. Set up your environment variables

The project needs a Google Maps API key to show satellite images.

1. In the project folder, create a file called `.env`
2. Add the following inside it:

```
GOOGLE_API_KEY=your_google_maps_api_key_here
PORT=3001
```

Replace `your_google_maps_api_key_here` with your actual Google Maps API key.

**How to get a Google Maps API key:**
- Go to https://console.cloud.google.com
- Create a project (or select an existing one)
- Enable the **Maps JavaScript API**, **Maps Static API**, and **Solar API**
- Go to Credentials → Create credentials → API key
- Copy the key into your `.env` file

---

## 5. Start the server

In your terminal, from inside the project folder, run:

```bash
node server.js
```

Or alternatively:

```bash
npm start
```

You should see output like:

```
Server running on http://localhost:3001
```

---

## 6. Open the app

Open your browser and go to:

```
http://localhost:3001
```

You should see the login page.

---

## 7. Log in

Use one of these accounts:

| Username | Password | Role |
|---|---|---|
| `admin` | `admin123` | Admin |
| `juliana` | `juliana123` | Team Member |
| `marcus` | `marcus123` | Team Member |

Check "Remember me" to stay logged in for 30 days.

---

## Stopping the server

Press `Ctrl + C` in the terminal to stop the server.

---

## Troubleshooting

| Problem | Fix |
|---|---|
| `node: command not found` | Node.js is not installed — go to step 1 |
| `Cannot find module 'express'` | Run `npm install` in the project folder |
| Satellite images not loading | Check your `GOOGLE_API_KEY` in the `.env` file |
| Port already in use | Change `PORT=3001` to another port in `.env` and visit that port |
| `.env` file not working | Make sure the file is named exactly `.env` (no `.txt` extension) |
