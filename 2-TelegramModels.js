/**
 * Telegram data models built on GSTable.
 *
 * Each class maps directly to one Google Sheets tab. Sheet names are derived
 * automatically from the class name:
 *   ReceivedMessage  ->  "ReceivedMessage"
 *   SentMessage      ->  "SentMessage"
 *   Conversation     ->  "Conversation"
 *
 * MIGRATION NOTE — breaking change vs. the original framework:
 *   Old:  conversation_data.chat_id          -> raw value (string/number)
 *   New:  conversation.chat_id               -> GSTable column object { _value, _type, _required }
 *         conversation.chat_id._value        -> raw value
 *         conversation.getChatId()           -> raw value (convenience getter)
 *
 * In step handlers, prefer using message.chat.id and message.from.id directly
 * rather than reading them from the conversation object.
 */

/**
 * Time-to-live for active conversations, in milliseconds.
 * A conversation that has not been updated within this window is considered
 * expired and will be deleted by expireConversations().
 * @const {number}
 */
const CONVERSATION_TTL_MS = 15 * 60 * 1000; // 15 minutes

// --- ReceivedMessage ---------------------------------------------------------

class ReceivedMessage extends GSTable {
  /**
   * @param {Date}   [date]
   * @param {string} [chat_id]
   * @param {string} [user_id]
   * @param {string} [content]  - not required (media messages have no text)
   */
  constructor(date, chat_id, user_id, content) {
    super();
    this.date    = GSTable.COLUMN().DATE(date    || new Date());
    this.chat_id = GSTable.COLUMN().STRING(chat_id || "");
    this.user_id = GSTable.COLUMN().STRING(user_id || "");
    this.content = GSTable.COLUMN().STRING(content || "", false); // not required
  }
}

// --- SentMessage -------------------------------------------------------------

class SentMessage extends GSTable {
  /**
   * @param {Date}   [date]
   * @param {string} [chat_id]
   * @param {string} [message_id]
   * @param {string} [content]
   */
  constructor(date, chat_id, message_id, content) {
    super();
    this.date       = GSTable.COLUMN().DATE(date       || new Date());
    this.chat_id    = GSTable.COLUMN().STRING(chat_id    || "");
    this.message_id = GSTable.COLUMN().STRING(message_id || "");
    this.content    = GSTable.COLUMN().STRING(content    || "", false);
  }
}

// --- Conversation ------------------------------------------------------------

class Conversation extends GSTable {
  /**
   * @param {Date}   [date]     - Creation / last-activity timestamp (used for TTL).
   * @param {string} [chat_id]
   * @param {string} [user_id]
   * @param {string} [payload]  - JSON string representing the multi-step state.
   */
  constructor(date, chat_id, user_id, payload) {
    super();
    this.date    = GSTable.COLUMN().DATE(date    || new Date());
    this.chat_id = GSTable.COLUMN().STRING(chat_id || "");
    this.user_id = GSTable.COLUMN().STRING(user_id || "");
    this.payload = GSTable.COLUMN().STRING(payload || "");
  }

  // --- Convenience getters ---------------------------------------------------
  // These return the raw value so step handlers can use them without knowing
  // the GSTable column-object structure.

  /**
   * Returns the raw chat_id string.
   * Use this instead of conversation.chat_id in step handlers.
   * @returns {string}
   */
  getChatId() {
    return String(this.chat_id._value);
  }

  /**
   * Returns the raw user_id string.
   * @returns {string}
   */
  getUserId() {
    return String(this.user_id._value);
  }

  /**
   * Parses and returns the payload as a JavaScript object.
   *
   * FIX: The previous version returned null on parse failure and relied on
   * every caller to handle that case — none of them did, guaranteeing a
   * downstream crash on a corrupted payload. This version throws immediately
   * with a descriptive message so the error surfaces at the right call site
   * (the Bot dispatcher) rather than as a cryptic "cannot read property of
   * null" later.
   *
   * @returns {Object}
   * @throws {Error} If the stored payload is not valid JSON.
   */
  getParsedPayload() {
    try {
      return JSON.parse(this.payload._value);
    } catch (e) {
      throw new Error(
        `[Conversation] Payload corrupted for chat_id=${this.getChatId()} ` +
        `user_id=${this.getUserId()} — ${e.message} | raw: ${this.payload._value}`
      );
    }
  }

  /**
   * Replaces the payload with a new object, refreshes the TTL, and persists.
   * @param {Object} payloadObject
   */
  updatePayload(payloadObject) {
    this.payload._value = JSON.stringify(payloadObject);
    this.date._value    = new Date(); // refresh TTL
    this.persist();
  }

  // --- Static helpers --------------------------------------------------------

  /**
   * Converts a date column value to a millisecond timestamp.
   * Apps Script may return either a Date object or a value that can be coerced
   * to one (ISO string, number). Returns NaN if the value is not a valid date.
   *
   * @param {Date|string|number} value
   * @returns {number}
   */
  static _toMs(value) {
    const ms = (value instanceof Date) ? value.getTime() : new Date(value).getTime();
    return ms;
  }

  // --- Static finders --------------------------------------------------------

  /**
   * Returns all non-expired conversations for a chat + user pair.
   * TTL is defined by {@link CONVERSATION_TTL_MS}.
   *
   * @param {string|number} chat_id
   * @param {string|number} user_id
   * @returns {Conversation[]}
   */
  static findActive(chat_id, user_id) {
    const now = Date.now();
    return Conversation.filterByConditions({
      chat_id: v => String(v._value) === String(chat_id),
      user_id: v => String(v._value) === String(user_id),
      date:    v => {
        const ms = Conversation._toMs(v._value);
        return !isNaN(ms) && (now - ms) < CONVERSATION_TTL_MS;
      },
    });
  }

  /**
   * Returns all conversations that have exceeded the TTL.
   * TTL is defined by {@link CONVERSATION_TTL_MS}.
   *
   * @returns {Conversation[]}
   */
  static findExpired() {
    const now = Date.now();
    return Conversation.filterByConditions({
      date: v => {
        const ms = Conversation._toMs(v._value);
        return !isNaN(ms) && (now - ms) >= CONVERSATION_TTL_MS;
      },
    });
  }
}