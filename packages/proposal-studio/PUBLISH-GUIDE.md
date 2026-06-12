# proposal-studio — How to publish to npm (Step by Step)

This guide is for you. Every time you want to release, just follow this — no need
to ask anyone what to do.

> **In short:** Run one command (`./publish.sh`) and everything — detecting
> first-time vs. update, bumping the version, building, pushing to GitHub, and
> publishing to npm — **happens automatically.**

---

## 🟢 One-time setup (do this only once)

You only need to do this once. You won't need it again after that.

### 1. Log in to npm

Type this command in your terminal:

```bash
npm login
```

It will ask for your npm username, password, and email. Enter them.
(Your npm account is **manibalan** — you're already logged in, so you may be able
to skip this.)

Check that login worked:

```bash
npm whoami
```

If it prints your npm username (e.g. `manibalan`), you're good ✅

### 2. Make the script executable

```bash
cd packages/proposal-studio
chmod +x publish.sh
```

That's it. First-time setup is done.

---

## 🚀 Every time you want to publish (this is the main step)

You made some changes to your code and now want to release them to npm. Do this:

### Step 1 — Go into the package folder

```bash
cd packages/proposal-studio
```

### Step 2 — Run the script

```bash
./publish.sh
```

That's all! The script handles the rest. Here's what happens 👇

---

## 📋 What the script does when you run it

### 1️⃣ Checks npm login
Verifies you're logged in to npm. If not, it stops and tells you to run `npm login`.

### 2️⃣ Auto-detects first-time vs. update publish
The script asks npm whether this package name already exists:

- **First-time publish** → the package isn't on npm yet. It publishes the
  **current version as-is** (no version bump — your `package.json` version is used).
- **Update publish** → the package already exists on npm. It asks you for a
  **patch / minor / major** bump before publishing.

You don't have to choose the mode — the script figures it out for you.

### 3️⃣ Checks for uncommitted git changes
If you have changes that aren't committed yet, it asks
"Commit these changes and continue? (y/n)".
- Type `y` → it continues
- Type `n` → it stops (so you can commit them yourself first)

### 4️⃣ (Update only) Asks which version bump
For an **update**, it shows:

```
  What kind of update is this?
    1) patch  — small fix / bug fix            (e.g. 0.1.1 → 0.1.2)
    2) minor  — new feature, nothing breaks    (e.g. 0.1.1 → 0.2.0)
    3) major  — big change, may break old code (e.g. 0.1.1 → 1.0.0)

  Your choice (1/2/3):
```

**Which one should you pick?**
- **1 (patch)** → just a small bug fix. *(this is the most common one)*
- **2 (minor)** → you added a new feature, but old code still works
- **3 (major)** → a big change; code written for the old version may break

Type the number and press **Enter**.

> For a **first-time publish**, this step is skipped — it keeps your current
> version and goes straight to building.

### 5️⃣ Builds
Creates a fresh `dist/` folder (`npm run build`). If a test exists, it runs that too.

### 6️⃣ Handles version + git commit
- **Update:** bumps the version in `package.json`, commits it, and creates a git tag.
- **First-time:** if there are any pending changes, it commits and tags the current version.

### 7️⃣ Pushes to GitHub
Pushes the commit and tag to GitHub, so your code stays in sync.

### 8️⃣ Publishes to npm
Finally it publishes to npm. When it's done you'll see:

```
 🎉 Update published!
  Package : proposal-studio
  Version : 0.1.2
  npm     : https://www.npmjs.com/package/proposal-studio
```

---

## ✅ How to confirm it published

Wait a minute, then run:

```bash
npm view proposal-studio version
```

If it shows the version you just published (e.g. `0.1.2`) — **success!** 🎉

Or open this link in your browser:
👉 https://www.npmjs.com/package/proposal-studio

---

## ❓ If something goes wrong (common problems)

| Problem | What to do |
|---------|-----------|
| `You must be logged in to publish` | Run `npm login` and log in |
| `You do not have permission to publish` | That npm account can't publish this package. Log in with the correct account |
| `Version already exists` / `cannot publish over existing version` | That version is already on npm. Re-run the script and pick a different (patch) version |
| `Build failed` | There's an error in your code. Fix it and try again |
| Push failed | Check your internet / GitHub login. Try running `git push` on its own |

> **Note:** If the build, version bump, and commit all succeed but only
> `npm publish` fails, your code is already on GitHub. In that case you can just
> run `npm publish --access public` on its own — no need to bump the version again.

---

## 🧠 One line to remember

```bash
cd packages/proposal-studio && ./publish.sh
```

Remember this one command and you're set — the script handles everything else. 👍
