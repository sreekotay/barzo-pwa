const fs = require('fs').promises;
const path = require('path');

const SUBSCRIPTIONS_FILE = path.join(process.cwd(), 'data', 'subscriptions.json');

// Ensure data directory exists
async function ensureDataDir() {
  const dataDir = path.dirname(SUBSCRIPTIONS_FILE);
  try {
    await fs.mkdir(dataDir, { recursive: true });
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
  }
}

// Load subscriptions from file
async function loadSubscriptions() {
  try {
    await ensureDataDir();
    const data = await fs.readFile(SUBSCRIPTIONS_FILE, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    if (error.code === 'ENOENT') return {};
    throw error;
  }
}

// Save subscriptions to file
async function saveSubscriptions(subscriptions) {
  await ensureDataDir();
  await fs.writeFile(SUBSCRIPTIONS_FILE, JSON.stringify(subscriptions, null, 2));
}

async function addSubscription(subscription, userId = 'anonymous') {
  const subscriptions = await loadSubscriptions();
  subscriptions[subscription.endpoint] = {
    subscription,
    userId,
    updatedAt: new Date().toISOString(),
    createdAt: subscriptions[subscription.endpoint]?.createdAt || new Date().toISOString()
  };
  await saveSubscriptions(subscriptions);
}

async function removeSubscription(endpoint) {
  const subscriptions = await loadSubscriptions();
  delete subscriptions[endpoint];
  await saveSubscriptions(subscriptions);
}

async function getSubscriptions(userId = null) {
  const subscriptions = await loadSubscriptions();
  return Object.values(subscriptions)
    .filter(sub => !userId || sub.userId === userId)
    .map(sub => sub.subscription);
}

module.exports = {
  addSubscription,
  removeSubscription,
  getSubscriptions
}; 