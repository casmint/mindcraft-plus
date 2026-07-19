const settings = {
    "minecraft_version": "1.21.6",
    "host": "mc.surfski.dev",
    "port": 25565,
    "auth": "microsoft",

    "mindserver_port": 8082,
    "auto_open_ui": false,

    "base_profile": "survival",
    "profiles": ["./profiles/surfski-autonomous.json"],

    "load_memory": false,
    "init_message": "You are Surfski. Load your profile instruction layers, inspect your immediate surroundings, and wait for the first test instruction.",

    "only_chat_with": [],
    "speak": false,
    "chat_ingame": true,
    "language": "en",
    "chat": {
        "enableQuickChat": false,
        "casualChatDoesNotInterrupt": true,
        "classifyBeforePlanning": true,
        "useQuickModelForChat": false,
        "maxCasualReplyChars": 120,
        "quickChatUsesLLM": true,
        "maxQuickChatChars": 120,
        "maxQuickChatHistoryTurns": 4,
        "quickChatNoCommands": true,
        "quickChatNoTools": true,
        "quickChatTimeoutMs": 5000,
        "fallbackToTemplateOnQuickChatError": true
    },
    "admin": { "enabled": true, "prefix": "!surfski", "persistRuntimeSettings": true },

    "render_bot_view": false,
    "allow_vision": false,
    "runtime_mode": "direct",
    "enable_mode_scheduler": true,

    "allow_insecure_coding": true,
    "blocked_actions": [],
    "code_timeout_mins": -1,

    "relevant_docs_count": 5,
    "max_messages": 15,
    "num_examples": 2,
    "max_commands": -1,

    "show_command_syntax": "full",
    "narrate_behavior": true,
    "chat_bot_messages": true,

    "spawn_timeout": 30,
    "block_place_delay": 0,
    "log_all_prompts": false
};

export default settings;
