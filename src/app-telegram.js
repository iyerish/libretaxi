/* eslint-disable no-console, no-use-before-define */
import './init';
import TelegramBot from 'tgfancy';
import { loadUser } from './factories/user-factory';
import CaQueue from './queue/ca-queue';
import callAction from './call-action';
import textToValue from './support/text-to-value';
import initLocale from './support/init-locale';
import InlineButtonCallback from './response-handlers/common/inline-button-callback';
import Settings from '../settings';

const settings = new Settings();
const api = new TelegramBot(settings.TELEGRAM_TOKEN, {
  polling: true,
  tgfancy: { orderedSending: true },
});
console.log('OK telegram bot is waiting for messages...');
const queue = new CaQueue();

api.on('message', (msg) => {
  const userKey = `telegram_${msg.chat.id}`;
  const something = msg.text || (msg.contact || {}).phone_number || getLocation(msg);
  console.log(`Got '${something}' from ${userKey}`);

  withUser(userKey, (user) => {
    queue.create({
      userKey,
      arg: msg.text ? textToValue(user, msg.text) : something,
      route: user.state.menuLocation || 'default',
    });
  });
});

api.on('callback_query', (msg) => {
  const userKey = `telegram_${msg.from.id}`;
  const data = msg.data;
  console.log(`Got inline button value ${data} from ${userKey}`);

  withUser(userKey, (user) => {
    const t = initLocale(user);
    api.editMessageText(t.__('global.replied_to_order'), {
      chat_id: msg.message.chat.id,
      message_id: msg.message.message_id,
    });
    new InlineButtonCallback({ user, value: data, api }).call();
  });
});

queue.process((job, done) => {
  const data = job.data;
  withUser(data.userKey, (user) => {
    callAction({
      user,
      arg: data.arg,
      route: data.route,
      queue,
      api,
    });
  })
  .then(() => done());
});

process.once('SIGTERM', () => {
  console.log('Shutting down gracefully...');
  api.stopPolling(); // TODO: improve when Telegram webhook used
  queue.queue.shutdown(5000, (err) => {
    console.log(`Kue shutdown: ${err || 'OK'}`);
    process.exit(0);
  });
});

const getLocation = (msg) => {
  if (!msg.location) return undefined;
  return [msg.location.latitude, msg.location.longitude];
};

const withUser = (userKey, f) => { // eslint-disable-line arrow-body-style
  return loadUser(userKey)
    .then((user) => {
      try {
        f(user);
      } catch (e) { handleException(e, user); }
    })
    .catch((err) => console.log(err));
};

const handleException = (ex, user) => {
  console.log(ex);
  try {
    const t = initLocale(user);
    api.sendMessage(user.platformId, t.__('global.error_try_again'),
      { disable_notification: true });
  } catch (e) {
    console.log(`Exception "${e}" while handing exception "${ex}"`);
  }
};
