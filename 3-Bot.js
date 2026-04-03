/**
 * Utility for building Telegram keyboard markup objects.
 * Replaces the static methods that were on TelegramBot.
 */
const KeyboardBuilder = {
  /**
   * Reply keyboard (custom buttons below the input field).
   * @param {Array<Array<string>>} elements
   * @returns {string|null}
   */
  reply(elements) {
    if (elements.length === 0) return null;
    return JSON.stringify({ keyboard: elements });
  },

  /**
   * Inline keyboard (buttons attached to a message).
   * @param {Array<Array<{text:string, callback_data:string}>>} elements
   * @returns {string|null}
   */
  inline(elements) {
    if (elements.length === 0) return null;
    return JSON.stringify({ inline_keyboard: elements });
  },

  /** Removes any existing reply keyboard. */
  remove() {
    return JSON.stringify({ remove_keyboard: true });
  },
};

// -----------------------------------------------------------------------------

class TelegramBot {

  /**
   * @param {string} token          - Telegram Bot API token.
   * @param {string} webAppId       - Google Apps Script web app deployment ID.
   * @param {string} spreadsheetId  - ID of the Google Sheets spreadsheet.
   * @param {string} devList        - Comma-separated list of developer chat IDs.
   */
  constructor(token, webAppId, spreadsheetId, devList) {
    this.token           = token;
    this.telegramUrl     = "https://api.telegram.org/bot" + token;
    this.fileTelegramUrl = "https://api.telegram.org/file/bot" + token;
    this.webAppUrl       = "https://script.google.com/macros/s/" + webAppId + "/exec";
    this.devList         = devList.split(",").map(id => id.trim());
    this.handlers        = {};
    this.errorHandler    = function(_bot, _error, _request) {};

    // Point GSTable at the correct spreadsheet (web apps have no "active" one).
    GSTable.setSpreadsheet(spreadsheetId);

    // Register the webhook. GSTable will create sheets on first use automatically.
    UrlFetchApp.fetch(this.telegramUrl + "/setWebhook?url=" + this.webAppUrl);
  }

  // --- Core API layer --------------------------------------------------------

  /**
   * Low-level POST to the Telegram Bot API.
   *
   * Uses the method-specific endpoint (e.g. /sendMessage) and sends JSON.
   * This avoids every UrlFetchApp form-encoding quirk:
   *   - null serialised as the string "null"
   *   - booleans serialised as "true"/"false" strings
   *   - numbers serialised as strings
   *
   * NOTE: only null and undefined are stripped from the body before sending.
   * Falsy-but-meaningful values like false and 0 are preserved intentionally.
   *
   * @param {Object} payload - Must contain a `method` string field.
   * @returns {Object}       - The `result` field from the API response.
   * @throws {Error}         - On HTTP or API-level error.
   */
  _callApi(payload) {
    const apiMethod = payload.method;

    // Build the JSON body: drop `method` and any null/undefined values.
    const body = {};
    Object.keys(payload).forEach(k => {
      if (k !== "method" && payload[k] !== null && payload[k] !== undefined) {
        body[k] = payload[k];
      }
    });

    const url     = this.telegramUrl + "/" + apiMethod;
    const options = {
      method:             "post",
      contentType:        "application/json",
      payload:            JSON.stringify(body),
      muteHttpExceptions: true,
    };

    const response = UrlFetchApp.fetch(url, options);
    const json     = JSON.parse(response.getContentText());

    if (!json.ok) {
      Logger.log(
        "[TelegramBot] API error | method: " + apiMethod +
        " | body: "     + JSON.stringify(body) +
        " | response: " + response.getContentText()
      );
      throw new Error("Telegram API error [" + json.error_code + "]: " + json.description);
    }

    return json.result;
  }

  /**
   * Wraps _callApi with exponential-backoff retry.
   * @param {Object} payload
   * @param {number} [retries=3]
   * @returns {Object}
   */
  _callApiWithRetry(payload, retries = 3) {
    for (let attempt = 0; attempt < retries; attempt++) {
      try {
        return this._callApi(payload);
      } catch (error) {
        if (attempt === retries - 1) throw error;
        Utilities.sleep(1000 * Math.pow(2, attempt)); // 1s, 2s, 4s
      }
    }
  }

  // --- Logging (via GSTable models) ------------------------------------------

  /**
   * Logs an incoming message to the ReceivedMessage sheet.
   * @param {Object} message - Raw Telegram message object.
   */
  _logReceived(message) {
    const copy = Object.assign({}, message);
    delete copy.from;
    delete copy.chat;
    delete copy.date;

    const record = new ReceivedMessage(
      new Date(message.date * 1000),
      String(message.chat.id),
      String(message.from.id),
      JSON.stringify(copy)
    );
    record.persist();
  }

  /**
   * Logs an outgoing message to the SentMessage sheet.
   * @param {Object} result - The result object returned by the Telegram API.
   */
  _logSent(result) {
    const copy = Object.assign({}, result);
    delete copy.from;
    delete copy.chat;
    delete copy.date;

    const record = new SentMessage(
      new Date(),
      String(result.chat.id),
      String(result.message_id),
      JSON.stringify(copy)
    );
    record.persist();
  }

  // --- Conversation management -----------------------------------------------

  /**
   * Returns the most recent active Conversation for this chat+user, or null.
   * @param {Object} message
   * @returns {Conversation|null}
   */
  _getActiveConversation(message) {
    const active = Conversation.findActive(message.chat.id, message.from.id);
    return active.length > 0 ? active[active.length - 1] : null;
  }

  /**
   * Creates a new Conversation entry for a multi-step command.
   * @param {Object} message
   * @param {Object} payload - Initial payload object.
   */
  _startConversation(message, payload) {
    const conv = new Conversation(
      new Date(),
      String(message.chat.id),
      String(message.from.id),
      JSON.stringify(payload)
    );
    conv.persist();
  }

  /**
   * Marks step `position` as completed, stores the user's answer, and
   * persists the updated payload.
   * @param {Conversation} conversation
   * @param {Object}       message
   * @param {number}       position - Zero-based step index.
   * @returns {Object}              - Updated payload object.
   */
  _updateConversation(conversation, message, position) {
    const payload = conversation.getParsedPayload();

    if (payload.data[position].type === "image") {
      payload.data[position].value = message.photo.pop().file_id;
    } else {
      payload.data[position].value = message.text;
    }

    payload.data[position].completed = true;
    conversation.updatePayload(payload); // refreshes TTL and persists
    return payload;
  }

  /**
   * Builds the initial payload for a multi-step command.
   * @param {string} commandName
   * @returns {Object}
   */
  _generateInitialPayload(commandName) {
    const states = this.handlers[commandName].callback.states;
    return {
      name: commandName,
      data: states.map(state => ({ type: state.type, value: null, completed: false })),
    };
  }

  /**
   * Deletes expired conversations and notifies developers.
   * Rows are deleted in descending order so that earlier row indices are not
   * shifted before they are processed.
   */
  expireConversations() {
    const expired = Conversation.findExpired();

    expired
      .sort((a, b) => b.row_number - a.row_number)
      .forEach(conv => conv.remove());

    if (expired.length > 0) {
      this.sendMessageToDevs("Eliminate " + expired.length + " conversazioni scadute.");
    }
  }

  // --- Handler registration --------------------------------------------------

  /**
   * Registers a command or callback-query handler.
   * @param {string}          command
   * @param {string}          description
   * @param {string}          type        - "command" | "callback_query"
   * @param {Function|Object} callback
   */
  addHandler(command, description, type, callback) {
    this.handlers[command] = { description, callback, type };
  }

  // --- Request dispatcher ----------------------------------------------------

  /**
   * Main entry point. Routes an incoming webhook payload to the correct handler.
   *
   * Handles two top-level shapes:
   *   - callback_query: inline-button tap — dispatched directly to a matching handler.
   *   - message: regular text/media — handed off to _main for conversation/command routing.
   *
   * @param {Object} request - Parsed webhook JSON from the Telegram update.
   */
  dispatcher(request) {
    const callbackQuery = request.callback_query;
    const message       = callbackQuery ? callbackQuery.message : request.message;

    if (callbackQuery) {
      this._dispatchCallbackQuery(callbackQuery, message, request);
      return;
    }

    const text     = message.text || "";
    const entities = message.entities || [];
    let   command  = "";
    let   params   = "";

    entities.every(entity => {
      if (entity.type === "bot_command") {
        command = text.substr(entity.offset, entity.length).split("@")[0];
        params  = text.substr(entity.offset + entity.length + 1);
        return false; // stop at the first command entity
      }
      return true;
    });

    try {
      this._main(message, command, params);
    } catch (error) {
      this.errorHandler(this, error, request);
    }
  }

  /**
   * Routes an inline-button tap to the matching callback_query handler.
   * Extracted from dispatcher to keep each branch readable on its own.
   *
   * @param {Object} callbackQuery - The callback_query object from the update.
   * @param {Object} message       - The message the button was attached to.
   * @param {Object} request       - The full webhook update (used for error reporting).
   */
  _dispatchCallbackQuery(callbackQuery, message, request) {
    const callbackData = callbackQuery.data;
    let matchedHandler = null;

    const cmds = Object.keys(this.handlers);
    for (let i = 0; i < cmds.length; i++) {
      const h = this.handlers[cmds[i]];
      if (h.type === "callback_query" && callbackData.includes(cmds[i])) {
        matchedHandler = h;
        break;
      }
    }

    if (matchedHandler) {
      matchedHandler.callback(this, callbackData, callbackQuery);
    } else {
      this.errorHandler(
        this,
        new Error("No callback_query handler matched: " + callbackData),
        request
      );
    }
  }

  /**
   * Core routing logic: logs the message, then either continues an active
   * conversation or dispatches a fresh command.
   *
   * @param {Object} message - Raw Telegram message object.
   * @param {string} command - Command string (e.g. "/start"), or "" if none.
   * @param {string} params  - Text that follows the command, or "".
   */
  _main(message, command, params) {
    this._logReceived(message);

    const conversation = this._getActiveConversation(message);

    if (conversation) {
      this._continueConversation(message, command, conversation);
    } else {
      this._dispatchCommand(message, command, params);
    }
  }

  /**
   * Advances an already-open multi-step conversation by one step.
   *
   * The step handler must return the index of the next pending step (i.e.
   * `firstPending + 1` to advance, or `firstPending` to stay on the same
   * step). Returning `payload.data.length` signals that all steps are done
   * and triggers `final`. Any other return value (including undefined) throws
   * immediately so that missing returns in step handlers surface clearly.
   *
   * @param {Object}       message      - Raw Telegram message object.
   * @param {string}       command      - Command string (may be "" mid-conversation).
   * @param {Conversation} conversation - The active Conversation record.
   */
  _continueConversation(message, command, conversation) {
    const payload     = conversation.getParsedPayload();
    const commandName = payload.name;
    const handlerObj  = this.handlers[commandName].callback;

    // Allow a registered fallback command to interrupt an open conversation
    // (e.g. /cancel). The fallback handler is responsible for removing the
    // conversation if needed.
    if (command && handlerObj.fallback && command === handlerObj.fallback.command) {
      handlerObj.fallback.handler(this, conversation, message);
      return;
    }

    const firstPending = payload.data.findIndex(state => !state.completed);
    if (firstPending === -1) return; // all steps already done (defensive)

    const progress = handlerObj.states[firstPending].handler(this, conversation, message);

    // Validate the return value so that a forgotten `return` in a step handler
    // produces a clear error instead of silently stalling the conversation.
    if (typeof progress !== "number") {
      throw new Error(
        `[TelegramBot] Step handler at index ${firstPending} of command ` +
        `"${commandName}" must return a number but returned ${JSON.stringify(progress)}. ` +
        `Did you forget a return statement?`
      );
    }

    let updatedPayload = payload;

    if (progress > firstPending) {
      updatedPayload = this._updateConversation(conversation, message, progress - 1);
    }

    if (progress === payload.data.length) {
      conversation.remove(); // close before calling final
      handlerObj.final(this, updatedPayload, message);
    }
  }

  /**
   * Dispatches a fresh (non-conversation) command to its registered handler.
   * If the handler has an `entry` function, a new multi-step conversation is
   * opened; otherwise the handler is called directly as a single-shot command.
   *
   * Silently ignores unknown commands (no handler registered).
   *
   * @param {Object} message - Raw Telegram message object.
   * @param {string} command - Command string (e.g. "/start").
   * @param {string} params  - Text that follows the command.
   */
  _dispatchCommand(message, command, params) {
    const commandObj = this.handlers[command];
    if (!commandObj) return;

    const handlerObj = commandObj.callback;

    if (handlerObj.entry) {
      const initPayload = this._generateInitialPayload(command);
      this._startConversation(message, initPayload);
      handlerObj.entry(this, params, message);
    } else {
      handlerObj(this, params, message);
    }
  }

  // --- Telegram send methods -------------------------------------------------

  /**
   * Sends a text message.
   * @param {string|number} id
   * @param {string}        text
   * @param {string|null}   [keyboard]
   * @returns {Object}
   */
  sendMessage(id, text, keyboard) {
    const result = this._callApiWithRetry({
      method:       "sendMessage",
      chat_id:      String(id),
      text:         text,
      parse_mode:   "HTML",
      reply_markup: keyboard || null,
    });
    this._logSent(result);
    return result;
  }

  /**
   * Sends a photo with an optional caption.
   * @param {string|number} id
   * @param {string}        caption
   * @param {string}        file_id
   * @param {string|null}   [keyboard]
   * @returns {Object}
   */
  sendPhoto(id, caption, file_id, keyboard) {
    const result = this._callApiWithRetry({
      method:       "sendPhoto",
      chat_id:      String(id),
      caption:      caption,
      parse_mode:   "HTML",
      photo:        file_id,
      reply_markup: keyboard || null,
    });
    this._logSent(result);
    return result;
  }

  /**
   * Edits the text of an already-sent message.
   * @param {string|number} chat_id
   * @param {string|number} message_id
   * @param {string}        text
   * @param {string|null}   [keyboard]
   * @returns {Object}
   */
  editMessageText(chat_id, message_id, text, keyboard) {
    return this._callApiWithRetry({
      method:       "editMessageText",
      chat_id:      String(chat_id),
      message_id:   message_id,
      text:         text,
      parse_mode:   "HTML",
      reply_markup: keyboard || null,
    });
  }

  /**
   * Answers a callback query (dismisses the loading spinner on the client).
   * @param {string} callback_query_id
   * @param {string} [text=""]
   */
  answerCallbackQuery(callback_query_id, text) {
    this._callApiWithRetry({
      method:            "answerCallbackQuery",
      callback_query_id: callback_query_id,
      text:              text || "",
    });
  }

  /**
   * Deletes a message.
   * @param {string|number} chat_id
   * @param {string|number} message_id
   */
  deleteMessage(chat_id, message_id) {
    this._callApiWithRetry({
      method:     "deleteMessage",
      chat_id:    String(chat_id),
      message_id: message_id,
    });
  }

  /**
   * Sends a message to every developer in devList.
   * A failure for one developer is logged but does not block the others.
   * @param {string} text
   */
  sendMessageToDevs(text) {
    this.devList.forEach(devId => {
      try {
        this.sendMessage(devId, text);
      } catch (error) {
        Logger.log("[TelegramBot] Failed to notify dev " + devId + ": " + error.message);
      }
    });
  }

  // --- File utilities --------------------------------------------------------

  /**
   * Returns the Telegram file object for a given file_id.
   * @param {string} file_id
   * @returns {GoogleAppsScript.URL_Fetch.HTTPResponse}
   */
  getFile(file_id) {
    return UrlFetchApp.fetch(this.telegramUrl + "/getFile?file_id=" + file_id);
  }

  /**
   * Downloads a file from the Telegram file server.
   * @param {string} path - Path returned by getFile().
   * @returns {GoogleAppsScript.URL_Fetch.HTTPResponse}
   */
  downloadFile(path) {
    return UrlFetchApp.fetch(this.fileTelegramUrl + "/" + path);
  }

  // --- Lifecycle -------------------------------------------------------------

  /** Call once after deployment to verify the bot is up. */
  firstLaunch() {
    this.sendMessageToDevs("Il bot e' attivo e funzionante!");
  }

  // --- Sheet reset helpers (dev/maintenance) ---------------------------------

  /**
   * Deletes all rows from the given model's sheet and notifies developers.
   * Rows are removed in descending order to keep earlier indices stable.
   * @param {typeof GSTable} ModelClass
   */
  _resetModel(ModelClass) {
    const all = ModelClass.findAll();
    all
      .sort((a, b) => b.row_number - a.row_number)
      .forEach(entity => entity.remove());
    this.sendMessageToDevs("Eliminate " + all.length + " righe da '" + ModelClass.name + "'");
  }

  resetReceivedSheet()     { this._resetModel(ReceivedMessage); }
  resetSentSheet()         { this._resetModel(SentMessage); }
  resetConversationSheet() { this._resetModel(Conversation); }

  // --- Static helpers (backward compatibility) --------------------------------

  /**
   * @deprecated Use KeyboardBuilder.reply() instead.
   */
  static addReplyKeyboardMarkup(elements) {
    Logger.log("[DEPRECATED] TelegramBot.addReplyKeyboardMarkup() — use KeyboardBuilder.reply()");
    return KeyboardBuilder.reply(elements || []);
  }

  /**
   * @deprecated Use KeyboardBuilder.inline() instead.
   */
  static addInlineKeyboardMarkup(elements) {
    Logger.log("[DEPRECATED] TelegramBot.addInlineKeyboardMarkup() — use KeyboardBuilder.inline()");
    return KeyboardBuilder.inline(elements || []);
  }

  /**
   * @deprecated Use KeyboardBuilder.remove() instead.
   */
  static addReplyKeyboardRemove() {
    Logger.log("[DEPRECATED] TelegramBot.addReplyKeyboardRemove() — use KeyboardBuilder.remove()");
    return KeyboardBuilder.remove();
  }

  // --- Dev / test helpers ----------------------------------------------------

  /**
   * Builds a synthetic Telegram webhook update object for a text message.
   * Useful for testing command handlers without a live Telegram connection.
   *
   * FIX: The original entity-building loop used `text.indexOf(" ")` as the
   * command length, which is an index, not a length. When no space followed
   * the command, `indexOf` returned -1, causing `searchFrom` to not advance
   * and the loop to stall. Rewritten to compute the true character count and
   * advance `searchFrom` correctly in all cases.
   *
   * @param {string} text - The message text, e.g. "/start" or "/cmd param".
   * @returns {Object}    - A webhook update object compatible with dispatcher().
   */
  generateMessageObject(text) {
    const firstDevId      = this.devList[0];
    const baseMsgFromChat = { id: firstDevId, first_name: "FirstName", last_name: "LastName", username: "Username" };
    const fromObj         = { ...baseMsgFromChat, language_code: "en", is_bot: false };
    const chatObj         = { ...baseMsgFromChat, type: "private" };

    const slashPositions = [];
    let searchIdx = 0;
    while (true) {
      const pos = text.indexOf("/", searchIdx);
      if (pos === -1) break;
      slashPositions.push(pos);
      searchIdx = pos + 1;
    }

    let entities = null;
    if (slashPositions.length > 0) {
      entities = slashPositions.map(offset => {
        // The command ends at the next space, or at the end of the string.
        const spaceAfter = text.indexOf(" ", offset);
        const cmdEnd     = spaceAfter > -1 ? spaceAfter : text.length;
        return { offset, length: cmdEnd - offset, type: "bot_command" };
      });
    }

    return {
      update_id: 143823073,
      message: {
        from:     fromObj,
        chat:     chatObj,
        date:     Math.floor(Date.now() / 1000),
        text:     text,
        entities: entities,
      },
    };
  }

  /**
   * Convenience wrapper: builds a synthetic message and runs it through
   * the full dispatcher pipeline. Useful for manual testing from the
   * Apps Script editor.
   * @param {string} text
   */
  simulateDispatch(text) {
    this.dispatcher(this.generateMessageObject(text));
  }
}