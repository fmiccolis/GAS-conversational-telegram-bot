/**
 * handlers.gs
 *
 * Defines all bot handlers and registers them via registerHandlers().
 *
 * USAGE
 * ─────
 * In your main.gs file , instantiate the bot and call registerHandlers:
 *
 *   const bot = new TelegramBot(TOKEN, WEBAPP_ID, SPREADSHEET_ID, DEV_LIST);
 *   registerHandlers(bot);
 *
 * STRUCTURE
 * ─────────
 *  1. Shared constants       — texts and limits reused across handlers
 *  2. Simple handlers        — /start, /help, /cancel, plain text
 *  3. Example conversation   — /report (multi-step: title → description → photo)
 *  4. errorHandler           — centralised error handling
 *  5. registerHandlers()     — registers everything on the bot
 *
 * STEP HANDLER CONTRACT
 * ─────────────────────
 * Every handler at `states[N].handler(bot, conversation, message)` must
 * return a number:
 *   • N            → invalid input; stays on the same step
 *   • N + 1        → input accepted; advances to the next step
 *   • data.length  → last step completed; triggers `final`
 */

// ─── 1. Shared constants ─────────────────────────────────────────────────────

/**
 * User-facing strings reused across multiple handlers.
 * Keeping them here avoids duplicate literals and makes copy changes easy.
 */
const MSG = {
  UNKNOWN_COMMAND:
    "I didn't understand that. Type /help to see the available commands.",

  CANCELLED:
    "❌ Operation cancelled.",

  ERROR_GENERIC:
    "⚠️ An unexpected error occurred. The development team has been notified.",

  VALIDATION: {
    TEXT_EMPTY:    "This field cannot be empty. Please try again:",
    TEXT_TOO_LONG: "Text is too long (max {max} characters). Please try again:",
    PHOTO_MISSING: "Please send a photo, not a text message.",
  },
};

/** Validation limits. */
const LIMITS = {
  TITLE_MAX:       80,
  DESCRIPTION_MAX: 500,
};

/** Report conversation steps */
const REPORT_STEPS = {
  TITLE: 0,
  DESCRIPTION: 1,
  IMAGE: 2,
  END: 3
}

// ─── 2. Simple handlers ──────────────────────────────────────────────────────

/**
 * Plain text with no command and no active conversation.
 * Registered under the "" key — the dispatcher routes here when the message
 * contains no bot_command entity.
 *
 * @param {TelegramBot} bot
 * @param {string}      _params  - Unused (no command means no params).
 * @param {Object}      message  - Raw Telegram message object.
 */
const plainTextHandler = (bot, _params, message) => {
  bot.sendMessage(message.chat.id, MSG.UNKNOWN_COMMAND);
};

// -----------------------------------------------------------------------------

/**
 * /start — Welcome message.
 * Sent automatically by Telegram when the user opens the chat for the first
 * time, or when they follow a t.me/botname?start=xxx deep link.
 *
 * @param {TelegramBot} bot
 * @param {string}      params  - Optional deep-link parameter after /start.
 * @param {Object}      message
 */
const startHandler = (bot, params, message) => {
  const name = message.from.first_name || "there";

  const text =
    `👋 Hello <b>${name}</b>!\n\n` +
    `I'm the example bot. Here's what you can do:\n\n` +
    `📋 /help — show available commands\n` +
    `📝 /report — submit a new report\n` +
    `❌ /cancel — cancel the current operation`;

  bot.sendMessage(message.chat.id, text);
};

// -----------------------------------------------------------------------------

/**
 * /help — Shows the list of available commands.
 *
 * @param {TelegramBot} bot
 * @param {string}      _params
 * @param {Object}      message
 */
const helpHandler = (bot, _params, message) => {
  const text =
    `📖 <b>Available commands</b>\n\n` +
    `/start — welcome message\n` +
    `/help — show this message\n` +
    `/report — submit a new report (title, description, photo)\n` +
    `/cancel — cancel any operation in progress`;

  bot.sendMessage(message.chat.id, text);
};

// -----------------------------------------------------------------------------

/**
 * /cancel — Used as a standalone command when no conversation is open.
 * When a conversation is active, the `fallback` registered on the specific
 * conversation handler is invoked instead (see below).
 *
 * @param {TelegramBot} bot
 * @param {string}      _params
 * @param {Object}      message
 */
const cancelHandler = (bot, _params, message) => {
  bot.sendMessage(message.chat.id, "There is no active operation to cancel.");
};

// ─── 3. Multi-step conversation: /report ─────────────────────────────────────

/**
 * Full handler for the /report command.
 *
 * Flow:
 *   step 0 — asks for the title        (text, max 80 characters)
 *   step 1 — asks for the description  (text, max 500 characters)
 *   step 2 — asks for a photo          (image)
 *   final  — shows a recap and saves (or notifies devs)
 *
 * Expected structure for TelegramBot._continueConversation:
 *   {
 *     entry(bot, params, message)    — starts the conversation
 *     states: [{ type, handler }]    — one element per step
 *     fallback: { command, handler } — command that interrupts the conversation
 *     final(bot, payload, message)   — closes the conversation on success
 *   }
 */
const reportHandler = {

  /**
   * Entry point: called once when the user sends /report.
   * Opens the conversation and asks for the first input.
   *
   * @param {TelegramBot} bot
   * @param {string}      _params
   * @param {Object}      message
   */
  entry(bot, _params, message) {
    const text =
      `📝 <b>New report</b>\n\n` +
      `Let's start! Send the <b>title</b> of your report.\n` +
      `(max ${LIMITS.TITLE_MAX} characters)\n\n` +
      `You can cancel at any time with /cancel.`;

    bot.sendMessage(message.chat.id, text);
  },

  states: [

    // ── Step 0: title ────────────────────────────────────────────────────────
    {
      type: "text",

      /**
       * Validates the title. Returns 0 to stay on this step, 1 to advance.
       *
       * @param {TelegramBot}  bot
       * @param {Conversation} conversation
       * @param {Object}       message
       * @returns {number}
       */
      handler(bot, conversation, message) {
        const text = (message.text || "").trim();

        if (!text) {
          bot.sendMessage(message.chat.id, MSG.VALIDATION.TEXT_EMPTY);
          return REPORT_STEPS.TITLE; // stays on title step
        }

        if (text.length > LIMITS.TITLE_MAX) {
          const warning = MSG.VALIDATION.TEXT_TOO_LONG
            .replace("{max}", LIMITS.TITLE_MAX);
          bot.sendMessage(message.chat.id, warning);
          return REPORT_STEPS.TITLE; // stays on title step
        }

        // Valid input: ask for the next piece of data.
        bot.sendMessage(
          message.chat.id,
          `✅ Title received.\n\nNow send the <b>description</b> of your report.\n` +
          `(max ${LIMITS.DESCRIPTION_MAX} characters)`
        );
        return REPORT_STEPS.DESCRIPTION; // advances to description step
      },
    },

    // ── Step 1: description ──────────────────────────────────────────────────
    {
      type: "text",

      /**
       * Validates the description. Returns 1 to stay, 2 to advance.
       *
       * @param {TelegramBot}  bot
       * @param {Conversation} conversation
       * @param {Object}       message
       * @returns {number}
       */
      handler(bot, conversation, message) {
        const text = (message.text || "").trim();

        if (!text) {
          bot.sendMessage(message.chat.id, MSG.VALIDATION.TEXT_EMPTY);
          return REPORT_STEPS.DESCRIPTION; // stays on description step
        }

        if (text.length > LIMITS.DESCRIPTION_MAX) {
          const warning = MSG.VALIDATION.TEXT_TOO_LONG
            .replace("{max}", LIMITS.DESCRIPTION_MAX);
          bot.sendMessage(message.chat.id, warning);
          return REPORT_STEPS.DESCRIPTION; // stays on description step
        }

        bot.sendMessage(
          message.chat.id,
          `✅ Description received.\n\nAlmost done! Now send the <b>photo</b> attached to your report.`
        );
        return REPORT_STEPS.IMAGE; // advances to image step
      },
    },

    // ── Step 2: photo ────────────────────────────────────────────────────────
    {
      type: "image",

      /**
       * Validates the presence of a photo. Returns 2 to stay, 3 (= data.length)
       * to complete the conversation and trigger `final`.
       *
       * @param {TelegramBot}  bot
       * @param {Conversation} conversation
       * @param {Object}       message
       * @returns {number}
       */
      handler(bot, conversation, message) {
        if (!message.photo || message.photo.length === 0) {
          bot.sendMessage(message.chat.id, MSG.VALIDATION.PHOTO_MISSING);
          return REPORT_STEPS.IMAGE; // stays on image step
        }

        // Valid input: return data.length (3) to close the conversation.
        return REPORT_STEPS.END;
      },
    },
  ],

  // ── Fallback: /cancel during the conversation ────────────────────────────

  fallback: {
    command: "/cancel",

    /**
     * Called when the user sends /cancel while the conversation is open.
     * Removes the conversation record and confirms the cancellation.
     *
     * @param {TelegramBot}  bot
     * @param {Conversation} conversation
     * @param {Object}       message
     */
    handler(bot, conversation, message) {
      conversation.remove();
      bot.sendMessage(
        message.chat.id,
        MSG.CANCELLED + "\n\nYour report has been discarded.",
        KeyboardBuilder.remove()
      );
    },
  },

  // ── Final: recap and save ────────────────────────────────────────────────

  /**
   * Called when all steps have been completed successfully.
   * Receives the updated payload with all values provided by the user.
   *
   * payload.data structure:
   *   [
   *     { type: "text",  value: "<title>",        completed: true },
   *     { type: "text",  value: "<description>",  completed: true },
   *     { type: "image", value: "<photo file_id>", completed: true },
   *   ]
   *
   * @param {TelegramBot} bot
   * @param {Object}      payload  - Final payload with all collected values.
   * @param {Object}      message  - Last message sent by the user.
   */
  final(bot, payload, message) {
    const title       = payload.data[0].value;
    const description = payload.data[1].value;
    const photoFileId = payload.data[2].value;

    // ── Save the data here (e.g. to a custom GSTable model) ──────────────────
    // const record = new Report(new Date(), String(message.chat.id), title, description, photoFileId);
    // record.persist();

    // Visual recap sent to the user.
    const recap =
      `✅ <b>Report submitted!</b>\n\n` +
      `📌 <b>Title:</b> ${title}\n` +
      `📄 <b>Description:</b> ${description}`;

    bot.sendPhoto(
      message.chat.id,
      recap,
      photoFileId,
      KeyboardBuilder.remove()
    );

    // Optional notification to developers with a text summary.
    bot.sendMessageToDevs(
      `📬 New report from @${message.from.username || message.from.id}\n\n` +
      `<b>Title:</b> ${title}\n` +
      `<b>Description:</b> ${description}`
    );
  },
};

// ─── 4. errorHandler ─────────────────────────────────────────────────────────

/**
 * Centralised error handler.
 * Assigned to `bot.errorHandler` and called by the dispatcher whenever an
 * unhandled exception is thrown inside any handler.
 *
 * Behaviour:
 *   - Logs the full error (including stack trace) to Apps Script Logger.
 *   - Sends a generic message to the user (no technical details exposed).
 *   - Notifies developers with: error message, stack trace, chat link,
 *     user link, and update_id.
 *
 * @param {TelegramBot} bot
 * @param {Error}       error
 * @param {Object}      request - The original webhook update (useful for debugging).
 */
const errorHandler = (bot, error, request) => {
  // Extract the message object regardless of the update type.
  const msg    = request.message || (request.callback_query && request.callback_query.message) || null;
  const chatId = msg ? msg.chat.id : null;
  const sender = msg ? msg.from    : null;
  const userId = sender ? sender.id : null;

  // ── Full log in the Apps Script editor ───────────────────────────────────
  Logger.log(
    "[errorHandler] " + error.message + "\n" +
    (error.stack || "(no stack)") + "\n" +
    "request: " + JSON.stringify(request)
  );

  // ── Generic message to the user: never expose internal details ───────────
  if (chatId) {
    try {
      bot.sendMessage(chatId, MSG.ERROR_GENERIC);
    } catch (sendError) {
      Logger.log("[errorHandler] Could not notify the user: " + sendError.message);
    }
  }

  // ── Developer notification ────────────────────────────────────────────────

  // Chat link: public channels and groups have a clickable username;
  // private chats open via tg://user?id=…
  let chatLink;
  if (msg && msg.chat.username) {
    chatLink = `<a href="https://t.me/${msg.chat.username}">${msg.chat.username}</a>`;
  } else if (chatId) {
    chatLink = `<a href="tg://user?id=${chatId}">${chatId}</a>`;
  } else {
    chatLink = "unknown";
  }

  // User link: use t.me if the user has a username, otherwise tg://user?id=…
  let userLink;
  if (sender && sender.username) {
    userLink = `<a href="https://t.me/${sender.username}">@${sender.username}</a>`;
  } else if (userId) {
    const fullName = [sender.first_name, sender.last_name].filter(Boolean).join(" ");
    userLink = `<a href="tg://user?id=${userId}">${fullName || userId}</a>`;
  } else {
    userLink = "unknown";
  }

  // Truncate the stack trace to 500 characters to stay well within Telegram's
  // 4096-character message limit when stacks are deeply nested.
  const stack = error.stack
    ? error.stack.slice(0, 500) + (error.stack.length > 500 ? "\n…(truncated)" : "")
    : "(no stack)";

  try {
    bot.sendMessageToDevs(
      `🚨 <b>Error</b>\n\n` +
      `<b>Message:</b> ${error.message}\n\n` +
      `<b>Stack trace:</b>\n<pre>${stack}</pre>\n` +
      `<b>Chat:</b> ${chatLink}\n` +
      `<b>User:</b> ${userLink}\n` +
      `<b>Update ID:</b> ${request.update_id || "N/A"}`
    );
  } catch (notifyError) {
    Logger.log("[errorHandler] Could not notify developers: " + notifyError.message);
  }
};

// ─── 5. registerHandlers ─────────────────────────────────────────────────────

/**
 * Registers all handlers on the bot and sets the error handler.
 * Call this function once, immediately after instantiating the bot.
 *
 * @example
 * // main.gs
 * const bot = new TelegramBot(TOKEN, WEBAPP_ID, SPREADSHEET_ID, DEV_LIST);
 * registerHandlers(bot);
 *
 * function doPost(e) {
 *   const update = JSON.parse(e.postData.contents);
 *   bot.dispatcher(update);
 * }
 *
 * @param {TelegramBot} bot
 */
function registerHandlers(bot) {
  // Global error handler.
  bot.errorHandler = errorHandler;

  // ── Simple command handlers ───────────────────────────────────────────────
  //   addHandler(key, description, type, callback)
  //
  //   type "command"        → callback = function(bot, params, message)
  //   type "callback_query" → callback = function(bot, callbackData, callbackQuery)

  bot.addHandler("",        "Plain text fallback",      "command", plainTextHandler);
  bot.addHandler("/start",  "Start the bot",            "command", startHandler);
  bot.addHandler("/help",   "Show available commands",  "command", helpHandler);
  bot.addHandler("/cancel", "Cancel current operation", "command", cancelHandler);

  // ── Multi-step conversation handlers ─────────────────────────────────────
  //   type "command", callback = object with entry / states / fallback / final

  bot.addHandler(
    "/report",
    "Submit a new report",
    "command",
    reportHandler
  );
}