/**
 * A pragmatic registry of stable Scratch 3 opcodes.
 *
 * It is intentionally not a complete Scratch-Blocks clone. It powers:
 *  - friendly defaults when add_block() creates a block
 *  - input/menu/substack metadata for the AST reader
 *  - primitive type selection when serializing literals
 *
 * Unknown opcodes (extensions, future Scratch blocks, raw hand-written SB3)
 * are still accepted by add_block(); users must then provide raw inputs.
 */

export type BlockShape = "hat" | "stack" | "cap" | "reporter" | "boolean" | "menu";

export type InputKind =
  | "number"
  | "positive_number"
  | "positive_integer"
  | "integer"
  | "angle"
  | "string"
  | "color"
  | "boolean"
  | "menu"
  | "broadcast";

export type FieldKind = "plain" | "variable" | "list" | "broadcast";

export interface InputSpec {
  name: string;
  kind: InputKind;
  default?: string | number;
  /** Opcode of the shadow menu block, for kind === "menu". */
  menu?: string;
  optional?: boolean;
}

export interface FieldSpec {
  name: string;
  default: string;
  kind?: FieldKind;
  options?: readonly string[];
}

export interface OpcodeSpec {
  opcode: string;
  shape: BlockShape;
  category: string;
  description: string;
  inputs: InputSpec[];
  fields: FieldSpec[];
  substacks: string[];
  /** True for blocks that only exist in TurboWarp or new scratch-vm builds. */
  turboWarpOnly?: boolean;
}

export const PRIMITIVE_BY_KIND: Partial<Record<InputKind, number>> = {
  number: 4,
  positive_number: 5,
  positive_integer: 6,
  integer: 7,
  angle: 8,
  color: 9,
  string: 10
};

export const SHAPE_HATS = new Set<BlockShape>(["hat"]);
export const SHAPE_CAPS = new Set<BlockShape>(["cap"]);
export const SHAPE_STATEMENTS = new Set<BlockShape>(["hat", "stack", "cap"]);
export const SHAPE_VALUE = new Set<BlockShape>(["reporter", "boolean"]);

const input = (
  name: string,
  kind: InputKind,
  defaultValue?: string | number,
  menu?: string,
  optional = false
): InputSpec => ({ name, kind, default: defaultValue, menu, optional });

const field = (
  name: string,
  defaultValue: string,
  kind: FieldKind = "plain",
  options?: readonly string[]
): FieldSpec => ({ name, default: defaultValue, kind, options });

const spec = (
  opcode: string,
  shape: BlockShape,
  category: string,
  description: string,
  options: {
    inputs?: InputSpec[];
    fields?: FieldSpec[];
    substacks?: string[];
    turboWarpOnly?: boolean;
  } = {}
): OpcodeSpec => ({
  opcode,
  shape,
  category,
  description,
  inputs: options.inputs ?? [],
  fields: options.fields ?? [],
  substacks: options.substacks ?? [],
  turboWarpOnly: options.turboWarpOnly
});

const MOTION: OpcodeSpec[] = [
  spec("motion_movesteps", "stack", "motion", "Move the sprite by a number of steps.", {
    inputs: [input("STEPS", "number", 10)]
  }),
  spec("motion_turnright", "stack", "motion", "Turn the sprite clockwise.", {
    inputs: [input("DEGREES", "number", 15)]
  }),
  spec("motion_turnleft", "stack", "motion", "Turn the sprite counter-clockwise.", {
    inputs: [input("DEGREES", "number", 15)]
  }),
  spec("motion_goto", "stack", "motion", "Go to a sprite, the mouse pointer, or a random position.", {
    inputs: [input("TO", "menu", "_random_", "motion_goto_menu")]
  }),
  spec("motion_gotoxy", "stack", "motion", "Go to an X/Y position.", {
    inputs: [input("X", "number", 0), input("Y", "number", 0)]
  }),
  spec("motion_glideto", "stack", "motion", "Glide to a sprite, the mouse pointer, or a random position.", {
    inputs: [
      input("SECS", "number", 1),
      input("TO", "menu", "_random_", "motion_glideto_menu")
    ]
  }),
  spec("motion_glidesecstoxy", "stack", "motion", "Glide to an X/Y position over some seconds.", {
    inputs: [input("SECS", "number", 1), input("X", "number", 0), input("Y", "number", 0)]
  }),
  spec("motion_pointindirection", "stack", "motion", "Point in a direction (0-360).", {
    inputs: [input("DIRECTION", "angle", 90)]
  }),
  spec("motion_pointtowards", "stack", "motion", "Point towards a sprite, the mouse pointer, or a random direction.", {
    inputs: [input("TOWARDS", "menu", "_random_", "motion_pointtowards_menu")]
  }),
  spec("motion_changexby", "stack", "motion", "Change the X position.", {
    inputs: [input("DX", "number", 10)]
  }),
  spec("motion_setx", "stack", "motion", "Set the X position.", {
    inputs: [input("X", "number", 0)]
  }),
  spec("motion_changeyby", "stack", "motion", "Change the Y position.", {
    inputs: [input("DY", "number", 10)]
  }),
  spec("motion_sety", "stack", "motion", "Set the Y position.", {
    inputs: [input("Y", "number", 0)]
  }),
  spec("motion_ifonedgebounce", "stack", "motion", "Bounce if touching the edge."),
  spec("motion_setrotationstyle", "stack", "motion", "Set the rotation style.", {
    fields: [field("STYLE", "all around", "plain", ["all around", "left-right", "don't rotate"])]
  }),
  spec("motion_xposition", "reporter", "motion", "Report the X position."),
  spec("motion_yposition", "reporter", "motion", "Report the Y position."),
  spec("motion_direction", "reporter", "motion", "Report the direction."),
  spec("motion_scroll_right", "stack", "motion", "TurboWarp scroll-right block.", {
    inputs: [input("DISTANCE", "number", 10)],
    turboWarpOnly: true
  }),
  spec("motion_scroll_up", "stack", "motion", "TurboWarp scroll-up block.", {
    inputs: [input("DISTANCE", "number", 10)],
    turboWarpOnly: true
  }),
  spec("motion_xscroll", "reporter", "motion", "TurboWarp X scroll reporter.", { turboWarpOnly: true }),
  spec("motion_yscroll", "reporter", "motion", "TurboWarp Y scroll reporter.", { turboWarpOnly: true })
];

const LOOKS: OpcodeSpec[] = [
  spec("looks_say", "stack", "looks", "Show a speech bubble.", {
    inputs: [input("MESSAGE", "string", "Hello!")]
  }),
  spec("looks_sayforsecs", "stack", "looks", "Show a speech bubble for some seconds.", {
    inputs: [input("MESSAGE", "string", "Hello!"), input("SECS", "positive_number", 2)]
  }),
  spec("looks_think", "stack", "looks", "Show a thought bubble.", {
    inputs: [input("MESSAGE", "string", "Hmm...")]
  }),
  spec("looks_thinkforsecs", "stack", "looks", "Show a thought bubble for some seconds.", {
    inputs: [input("MESSAGE", "string", "Hmm..."), input("SECS", "positive_number", 2)]
  }),
  spec("looks_show", "stack", "looks", "Show the sprite."),
  spec("looks_hide", "stack", "looks", "Hide the sprite."),
  spec("looks_hideallsprites", "stack", "looks", "Hide all sprites (TurboWarp).", { turboWarpOnly: true }),
  spec("looks_changeeffectby", "stack", "looks", "Change a graphic effect.", {
    inputs: [input("CHANGE", "number", 25)],
    fields: [
      field("EFFECT", "color", "plain", [
        "color",
        "fisheye",
        "whirl",
        "pixelate",
        "mosaic",
        "brightness",
        "ghost"
      ])
    ]
  }),
  spec("looks_seteffectto", "stack", "looks", "Set a graphic effect.", {
    inputs: [input("VALUE", "number", 0)],
    fields: [
      field("EFFECT", "color", "plain", [
        "color",
        "fisheye",
        "whirl",
        "pixelate",
        "mosaic",
        "brightness",
        "ghost"
      ])
    ]
  }),
  spec("looks_cleargraphiceffects", "stack", "looks", "Clear all graphic effects."),
  spec("looks_changesizeby", "stack", "looks", "Change the sprite size.", {
    inputs: [input("CHANGE", "number", 10)]
  }),
  spec("looks_setsizeto", "stack", "looks", "Set the sprite size.", {
    inputs: [input("SIZE", "number", 100)]
  }),
  spec("looks_switchcostumeto", "stack", "looks", "Switch to a costume.", {
    inputs: [input("COSTUME", "menu", "", "looks_costume")]
  }),
  spec("looks_nextcostume", "stack", "looks", "Switch to the next costume."),
  spec("looks_switchbackdropto", "stack", "looks", "Switch to a backdrop.", {
    inputs: [input("BACKDROP", "menu", "", "looks_backdrops")]
  }),
  spec("looks_switchbackdroptoandwait", "stack", "looks", "Switch to a backdrop and wait.", {
    inputs: [input("BACKDROP", "menu", "", "looks_backdrops")]
  }),
  spec("looks_nextbackdrop", "stack", "looks", "Switch to the next backdrop."),
  spec("looks_gotofrontback", "stack", "looks", "Move the sprite to the front or back layer.", {
    fields: [field("FRONT_BACK", "front", "plain", ["front", "back"])]
  }),
  spec("looks_goforwardbackwardlayers", "stack", "looks", "Move the sprite forward or backward in layers.", {
    inputs: [input("NUM", "positive_integer", 1)],
    fields: [field("FORWARD_BACKWARD", "forward", "plain", ["forward", "backward"])]
  }),
  spec("looks_size", "reporter", "looks", "Report the sprite size."),
  spec("looks_costumenumbername", "reporter", "looks", "Report the costume number or name.", {
    fields: [field("NUMBER_NAME", "number", "plain", ["number", "name"])]
  }),
  spec("looks_backdropnumbername", "reporter", "looks", "Report the backdrop number or name.", {
    fields: [field("NUMBER_NAME", "number", "plain", ["number", "name"])]
  }),
  spec("looks_changestretchby", "stack", "looks", "TurboWarp stretch block.", {
    inputs: [input("CHANGE", "number", 10)],
    turboWarpOnly: true
  }),
  spec("looks_setstretchto", "stack", "looks", "TurboWarp stretch block.", {
    inputs: [input("STRETCH", "number", 100)],
    turboWarpOnly: true
  })
];

const SOUND: OpcodeSpec[] = [
  spec("sound_play", "stack", "sound", "Start a sound.", {
    inputs: [input("SOUND_MENU", "menu", "", "sound_sounds_menu")]
  }),
  spec("sound_playuntildone", "stack", "sound", "Play a sound until it finishes.", {
    inputs: [input("SOUND_MENU", "menu", "", "sound_sounds_menu")]
  }),
  spec("sound_stopallsounds", "stack", "sound", "Stop all sounds."),
  spec("sound_seteffectto", "stack", "sound", "Set a sound effect.", {
    inputs: [input("VALUE", "number", 0)],
    fields: [field("EFFECT", "pitch", "plain", ["pitch", "pan"])]
  }),
  spec("sound_changeeffectby", "stack", "sound", "Change a sound effect.", {
    inputs: [input("VALUE", "number", 0)],
    fields: [field("EFFECT", "pitch", "plain", ["pitch", "pan"])]
  }),
  spec("sound_cleareffects", "stack", "sound", "Clear sound effects."),
  spec("sound_changevolumeby", "stack", "sound", "Change the volume.", {
    inputs: [input("VOLUME", "number", -10)]
  }),
  spec("sound_setvolumeto", "stack", "sound", "Set the volume.", {
    inputs: [input("VOLUME", "number", 100)]
  }),
  spec("sound_volume", "reporter", "sound", "Report the volume.")
];

const EVENTS: OpcodeSpec[] = [
  spec("event_whenflagclicked", "hat", "events", "Run when the green flag is clicked."),
  spec("event_whenkeypressed", "hat", "events", "Run when a key is pressed.", {
    fields: [field("KEY_OPTION", "space", "plain", ["space", "up arrow", "down arrow", "right arrow", "left arrow", "any"])]
  }),
  spec("event_whenthisspriteclicked", "hat", "events", "Run when this sprite is clicked."),
  spec("event_whenstageclicked", "hat", "events", "Run when the stage is clicked."),
  spec("event_whenbackdropswitchesto", "hat", "events", "Run when the backdrop switches.", {
    fields: [field("BACKDROP", "backdrop1")]
  }),
  spec("event_whengreaterthan", "hat", "events", "Run when a sensing value is greater than a number.", {
    inputs: [input("VALUE", "number", 10)],
    fields: [field("WHENGREATERTHANMENU", "TIMER", "plain", ["LOUDNESS", "TIMER"])]
  }),
  spec("event_whenbroadcastreceived", "hat", "events", "Run when a broadcast is received.", {
    fields: [field("BROADCAST_OPTION", "message1", "broadcast")]
  }),
  spec("event_broadcast", "stack", "events", "Send a broadcast.", {
    inputs: [input("BROADCAST_INPUT", "broadcast", "message1")]
  }),
  spec("event_broadcastandwait", "stack", "events", "Send a broadcast and wait for the receivers.", {
    inputs: [input("BROADCAST_INPUT", "broadcast", "message1")]
  }),
  spec("event_whentouchingobject", "hat", "events", "Run when touching an object (TurboWarp).", {
    inputs: [input("TOUCHINGOBJECTMENU", "menu", "_mouse_", "event_touchingobjectmenu")],
    turboWarpOnly: true
  })
];

const CONTROL: OpcodeSpec[] = [
  spec("control_wait", "stack", "control", "Wait for some seconds.", {
    inputs: [input("DURATION", "positive_number", 1)]
  }),
  spec("control_repeat", "stack", "control", "Repeat a stack a number of times.", {
    inputs: [input("TIMES", "positive_integer", 10)],
    substacks: ["SUBSTACK"]
  }),
  spec("control_forever", "cap", "control", "Repeat a stack forever.", {
    substacks: ["SUBSTACK"]
  }),
  spec("control_if", "stack", "control", "Run a stack if a condition is true.", {
    inputs: [input("CONDITION", "boolean", undefined, undefined, true)],
    substacks: ["SUBSTACK"]
  }),
  spec("control_if_else", "stack", "control", "Run one of two stacks depending on a condition.", {
    inputs: [input("CONDITION", "boolean", undefined, undefined, true)],
    substacks: ["SUBSTACK", "SUBSTACK2"]
  }),
  spec("control_wait_until", "stack", "control", "Wait until a condition is true.", {
    inputs: [input("CONDITION", "boolean", undefined, undefined, true)]
  }),
  spec("control_repeat_until", "stack", "control", "Repeat until a condition is true.", {
    inputs: [input("CONDITION", "boolean", undefined, undefined, true)],
    substacks: ["SUBSTACK"]
  }),
  spec("control_while", "stack", "control", "Repeat while a condition is true.", {
    inputs: [input("CONDITION", "boolean", undefined, undefined, true)],
    substacks: ["SUBSTACK"]
  }),
  spec("control_for_each", "stack", "control", "Run a stack once for each item in a list.", {
    inputs: [input("VALUE", "number", 0)],
    fields: [field("VARIABLE", "", "variable")],
    substacks: ["SUBSTACK"]
  }),
  spec("control_stop", "cap", "control", "Stop this script, other scripts, or all scripts.", {
    fields: [field("STOP_OPTION", "all", "plain", ["all", "this script", "other scripts in sprite"])]
  }),
  spec("control_start_as_clone", "hat", "control", "Run when a clone is created."),
  spec("control_create_clone_of", "stack", "control", "Create a clone of a sprite.", {
    inputs: [input("CLONE_OPTION", "menu", "_myself_", "control_create_clone_of_menu")]
  }),
  spec("control_delete_this_clone", "cap", "control", "Delete this clone."),
  spec("control_all_at_once", "stack", "control", "Run all of a stack in one frame.", {
    substacks: ["SUBSTACK"],
    turboWarpOnly: true
  }),
  spec("control_get_counter", "reporter", "control", "TurboWarp counter reporter.", { turboWarpOnly: true }),
  spec("control_incr_counter", "stack", "control", "Increment the TurboWarp counter.", { turboWarpOnly: true }),
  spec("control_clear_counter", "stack", "control", "Clear the TurboWarp counter.", { turboWarpOnly: true })
];

const SENSING: OpcodeSpec[] = [
  spec("sensing_touchingobject", "boolean", "sensing", "Report whether the sprite touches an object.", {
    inputs: [input("TOUCHINGOBJECTMENU", "menu", "_mouse_", "sensing_touchingobjectmenu")]
  }),
  spec("sensing_touchingcolor", "boolean", "sensing", "Report whether the sprite touches a color.", {
    inputs: [input("COLOR", "color", "#ff0000")]
  }),
  spec("sensing_coloristouchingcolor", "boolean", "sensing", "Report whether a color touches another color.", {
    inputs: [input("COLOR", "color", "#ff0000"), input("COLOR2", "color", "#0000ff")]
  }),
  spec("sensing_distanceto", "reporter", "sensing", "Report the distance to an object.", {
    inputs: [input("DISTANCETOMENU", "menu", "_mouse_", "sensing_distancetomenu")]
  }),
  spec("sensing_askandwait", "stack", "sensing", "Ask a question and wait for an answer.", {
    inputs: [input("QUESTION", "string", "What's your name?")]
  }),
  spec("sensing_answer", "reporter", "sensing", "Report the answer to the last question."),
  spec("sensing_keypressed", "boolean", "sensing", "Report whether a key is pressed.", {
    inputs: [input("KEY_OPTION", "menu", "space", "sensing_keyoptions")]
  }),
  spec("sensing_mousedown", "boolean", "sensing", "Report whether the mouse is down."),
  spec("sensing_mousex", "reporter", "sensing", "Report the mouse X position."),
  spec("sensing_mousey", "reporter", "sensing", "Report the mouse Y position."),
  spec("sensing_setdragmode", "stack", "sensing", "Set the sprite drag mode.", {
    fields: [field("DRAG_MODE", "draggable", "plain", ["draggable", "not draggable"])]
  }),
  spec("sensing_loudness", "reporter", "sensing", "Report the microphone loudness."),
  spec("sensing_loud", "boolean", "sensing", "Report whether the microphone is loud (TurboWarp).", { turboWarpOnly: true }),
  spec("sensing_timer", "reporter", "sensing", "Report the timer."),
  spec("sensing_resettimer", "stack", "sensing", "Reset the timer."),
  spec("sensing_of", "reporter", "sensing", "Report a property of a stage or sprite.", {
    inputs: [input("OBJECT", "menu", "_stage_", "sensing_of_object_menu")],
    fields: [field("PROPERTY", "x position")]
  }),
  spec("sensing_current", "reporter", "sensing", "Report the current date/time component.", {
    fields: [
      field("CURRENTMENU", "YEAR", "plain", [
        "YEAR",
        "MONTH",
        "DATE",
        "DAYOFWEEK",
        "HOUR",
        "MINUTE",
        "SECOND"
      ])
    ]
  }),
  spec("sensing_dayssince2000", "reporter", "sensing", "Report days since 2000."),
  spec("sensing_username", "reporter", "sensing", "Report the username."),
  spec("sensing_online", "boolean", "sensing", "Report whether the project is online (TurboWarp).", { turboWarpOnly: true }),
  spec("sensing_userid", "reporter", "sensing", "Report the user ID (TurboWarp).", { turboWarpOnly: true })
];

const OPERATORS: OpcodeSpec[] = [
  spec("operator_add", "reporter", "operators", "Add two numbers.", {
    inputs: [input("NUM1", "number", 0), input("NUM2", "number", 0)]
  }),
  spec("operator_subtract", "reporter", "operators", "Subtract two numbers.", {
    inputs: [input("NUM1", "number", 0), input("NUM2", "number", 0)]
  }),
  spec("operator_multiply", "reporter", "operators", "Multiply two numbers.", {
    inputs: [input("NUM1", "number", 0), input("NUM2", "number", 0)]
  }),
  spec("operator_divide", "reporter", "operators", "Divide two numbers.", {
    inputs: [input("NUM1", "number", 0), input("NUM2", "number", 0)]
  }),
  spec("operator_random", "reporter", "operators", "Pick a random number in a range.", {
    inputs: [input("FROM", "number", 1), input("TO", "number", 10)]
  }),
  spec("operator_gt", "boolean", "operators", "Report whether the first value is greater than the second.", {
    inputs: [input("OPERAND1", "string", ""), input("OPERAND2", "string", "50")]
  }),
  spec("operator_lt", "boolean", "operators", "Report whether the first value is less than the second.", {
    inputs: [input("OPERAND1", "string", ""), input("OPERAND2", "string", "50")]
  }),
  spec("operator_equals", "boolean", "operators", "Report whether two values are equal.", {
    inputs: [input("OPERAND1", "string", ""), input("OPERAND2", "string", "50")]
  }),
  spec("operator_and", "boolean", "operators", "Logical AND.", {
    inputs: [
      input("OPERAND1", "boolean", undefined, undefined, true),
      input("OPERAND2", "boolean", undefined, undefined, true)
    ]
  }),
  spec("operator_or", "boolean", "operators", "Logical OR.", {
    inputs: [
      input("OPERAND1", "boolean", undefined, undefined, true),
      input("OPERAND2", "boolean", undefined, undefined, true)
    ]
  }),
  spec("operator_not", "boolean", "operators", "Logical NOT.", {
    inputs: [input("OPERAND", "boolean", undefined, undefined, true)]
  }),
  spec("operator_join", "reporter", "operators", "Join two strings.", {
    inputs: [input("STRING1", "string", "apple "), input("STRING2", "string", "banana")]
  }),
  spec("operator_letter_of", "reporter", "operators", "Get a letter from a string.", {
    inputs: [input("LETTER", "positive_integer", 1), input("STRING", "string", "apple")]
  }),
  spec("operator_length", "reporter", "operators", "Get the length of a string.", {
    inputs: [input("STRING", "string", "apple")]
  }),
  spec("operator_contains", "boolean", "operators", "Report whether a string contains another string.", {
    inputs: [input("STRING1", "string", "apple"), input("STRING2", "string", "a")]
  }),
  spec("operator_mod", "reporter", "operators", "Remainder of division.", {
    inputs: [input("NUM1", "number", 0), input("NUM2", "number", 0)]
  }),
  spec("operator_round", "reporter", "operators", "Round a number.", {
    inputs: [input("NUM", "number", 0)]
  }),
  spec("operator_mathop", "reporter", "operators", "Apply a math operation.", {
    inputs: [input("NUM", "number", 0)],
    fields: [
      field("OPERATOR", "abs", "plain", [
        "abs",
        "floor",
        "ceiling",
        "sqrt",
        "sin",
        "cos",
        "tan",
        "asin",
        "acos",
        "atan",
        "ln",
        "log",
        "e ^",
        "10 ^"
      ])
    ]
  })
];

const DATA: OpcodeSpec[] = [
  spec("data_variable", "reporter", "data", "Report the value of a variable.", {
    fields: [field("VARIABLE", "", "variable")]
  }),
  spec("data_setvariableto", "stack", "data", "Set a variable to a value.", {
    inputs: [input("VALUE", "string", "0")],
    fields: [field("VARIABLE", "", "variable")]
  }),
  spec("data_changevariableby", "stack", "data", "Change a variable by a number.", {
    inputs: [input("VALUE", "number", 1)],
    fields: [field("VARIABLE", "", "variable")]
  }),
  spec("data_showvariable", "stack", "data", "Show a variable monitor.", {
    fields: [field("VARIABLE", "", "variable")]
  }),
  spec("data_hidevariable", "stack", "data", "Hide a variable monitor.", {
    fields: [field("VARIABLE", "", "variable")]
  }),
  spec("data_listcontents", "reporter", "data", "Report the contents of a list.", {
    fields: [field("LIST", "", "list")]
  }),
  spec("data_addtolist", "stack", "data", "Add an item to a list.", {
    inputs: [input("ITEM", "string", "thing")],
    fields: [field("LIST", "", "list")]
  }),
  spec("data_deleteoflist", "stack", "data", "Delete an item from a list.", {
    inputs: [input("INDEX", "positive_integer", 1)],
    fields: [field("LIST", "", "list")]
  }),
  spec("data_deletealloflist", "stack", "data", "Delete all items from a list.", {
    fields: [field("LIST", "", "list")]
  }),
  spec("data_insertatlist", "stack", "data", "Insert an item into a list.", {
    inputs: [input("ITEM", "string", "thing"), input("INDEX", "positive_integer", 1)],
    fields: [field("LIST", "", "list")]
  }),
  spec("data_replaceitemoflist", "stack", "data", "Replace an item in a list.", {
    inputs: [input("INDEX", "positive_integer", 1), input("ITEM", "string", "thing")],
    fields: [field("LIST", "", "list")]
  }),
  spec("data_itemoflist", "reporter", "data", "Report an item from a list.", {
    inputs: [input("INDEX", "positive_integer", 1)],
    fields: [field("LIST", "", "list")]
  }),
  spec("data_itemnumoflist", "reporter", "data", "Report the index of an item in a list.", {
    inputs: [input("ITEM", "string", "thing")],
    fields: [field("LIST", "", "list")]
  }),
  spec("data_lengthoflist", "reporter", "data", "Report the length of a list.", {
    fields: [field("LIST", "", "list")]
  }),
  spec("data_listcontainsitem", "boolean", "data", "Report whether a list contains an item.", {
    inputs: [input("ITEM", "string", "thing")],
    fields: [field("LIST", "", "list")]
  }),
  spec("data_showlist", "stack", "data", "Show a list monitor.", {
    fields: [field("LIST", "", "list")]
  }),
  spec("data_hidelist", "stack", "data", "Hide a list monitor.", {
    fields: [field("LIST", "", "list")]
  })
];

const PROCEDURES: OpcodeSpec[] = [
  spec("argument_reporter_string_number", "reporter", "procedures", "Report a custom block string/number argument.", {
    fields: [field("VALUE", "")]
  }),
  spec("argument_reporter_boolean", "boolean", "procedures", "Report a custom block boolean argument.", {
    fields: [field("VALUE", "")]
  }),
  spec("procedures_call", "stack", "procedures", "Call a custom block. Requires a mutation with proccode/argumentids.", {
    turboWarpOnly: false
  }),
  spec("procedures_definition", "hat", "procedures", "Define a custom block. Advanced: provide raw inputs/mutation.", {
    substacks: ["SUBSTACK"]
  })
];

const MENUS: OpcodeSpec[] = [
  spec("motion_goto_menu", "menu", "motion", "Go-to menu shadow.", {
    fields: [field("TO", "_random_")]
  }),
  spec("motion_glideto_menu", "menu", "motion", "Glide-to menu shadow.", {
    fields: [field("TO", "_random_")]
  }),
  spec("motion_pointtowards_menu", "menu", "motion", "Point-towards menu shadow.", {
    fields: [field("TOWARDS", "_random_")]
  }),
  spec("looks_costume", "menu", "looks", "Costume menu shadow.", {
    fields: [field("COSTUME", "")]
  }),
  spec("looks_backdrops", "menu", "looks", "Backdrop menu shadow.", {
    fields: [field("BACKDROP", "")]
  }),
  spec("sound_sounds_menu", "menu", "sound", "Sound menu shadow.", {
    fields: [field("SOUND_MENU", "")]
  }),
  spec("event_touchingobjectmenu", "menu", "events", "Touching-object menu shadow.", {
    fields: [field("TOUCHINGOBJECTMENU", "_mouse_")]
  }),
  spec("event_broadcast_menu", "menu", "events", "Broadcast menu shadow.", {
    fields: [field("BROADCAST_OPTION", "message1", "broadcast")]
  }),
  spec("control_create_clone_of_menu", "menu", "control", "Clone-target menu shadow.", {
    fields: [field("CLONE_OPTION", "_myself_")]
  }),
  spec("sensing_touchingobjectmenu", "menu", "sensing", "Touching-object menu shadow.", {
    fields: [field("TOUCHINGOBJECTMENU", "_mouse_")]
  }),
  spec("sensing_distancetomenu", "menu", "sensing", "Distance-to menu shadow.", {
    fields: [field("DISTANCETOMENU", "_mouse_")]
  }),
  spec("sensing_keyoptions", "menu", "sensing", "Key menu shadow.", {
    fields: [field("KEY_OPTION", "space")]
  }),
  spec("sensing_of_object_menu", "menu", "sensing", "Object-of menu shadow.", {
    fields: [field("OBJECT", "_stage_")]
  }),
  spec("data_listindexall", "menu", "data", "List index shadow with all/last.", {
    fields: [field("INDEX", "1")]
  }),
  spec("data_listindexrandom", "menu", "data", "List index shadow with random/last.", {
    fields: [field("INDEX", "1")]
  }),
  spec("math_number", "menu", "operators", "Number shadow.", {
    fields: [field("NUM", "0")]
  }),
  spec("math_positive_number", "menu", "operators", "Positive number shadow.", {
    fields: [field("NUM", "1")]
  }),
  spec("math_whole_number", "menu", "operators", "Whole number shadow.", {
    fields: [field("NUM", "1")]
  }),
  spec("math_integer", "menu", "operators", "Integer shadow.", {
    fields: [field("NUM", "0")]
  }),
  spec("math_angle", "menu", "operators", "Angle shadow.", {
    fields: [field("NUM", "90")]
  }),
  spec("text", "menu", "operators", "Text shadow.", {
    fields: [field("TEXT", "")]
  }),
  spec("colour_picker", "menu", "sensing", "Color shadow.", {
    fields: [field("COLOUR", "#ff0000")]
  })
];

const ALL_SPECS: OpcodeSpec[] = [
  ...MOTION,
  ...LOOKS,
  ...SOUND,
  ...EVENTS,
  ...CONTROL,
  ...SENSING,
  ...OPERATORS,
  ...DATA,
  ...PROCEDURES,
  ...MENUS
];

export const BLOCK_REGISTRY: Record<string, OpcodeSpec> = Object.fromEntries(
  ALL_SPECS.map((entry) => [entry.opcode, entry])
);

const ALIASES: Record<string, string> = {
  move_steps: "motion_movesteps",
  turn_right: "motion_turnright",
  turn_left: "motion_turnleft",
  go_to_xy: "motion_gotoxy",
  glide_to_xy: "motion_glidesecstoxy",
  point_in_direction: "motion_pointindirection",
  point_towards: "motion_pointtowards",
  change_x: "motion_changexby",
  set_x: "motion_setx",
  change_y: "motion_changeyby",
  set_y: "motion_sety",
  say: "looks_say",
  say_for_secs: "looks_sayforsecs",
  think: "looks_think",
  think_for_secs: "looks_thinkforsecs",
  show: "looks_show",
  hide: "looks_hide",
  switch_costume: "looks_switchcostumeto",
  next_costume: "looks_nextcostume",
  switch_backdrop: "looks_switchbackdropto",
  next_backdrop: "looks_nextbackdrop",
  set_size: "looks_setsizeto",
  change_size: "looks_changesizeby",
  play_sound: "sound_play",
  play_sound_until_done: "sound_playuntildone",
  set_volume: "sound_setvolumeto",
  change_volume: "sound_changevolumeby",
  when_flag_clicked: "event_whenflagclicked",
  when_key_pressed: "event_whenkeypressed",
  when_this_sprite_clicked: "event_whenthisspriteclicked",
  when_stage_clicked: "event_whenstageclicked",
  when_backdrop_switches_to: "event_whenbackdropswitchesto",
  when_broadcast_received: "event_whenbroadcastreceived",
  broadcast: "event_broadcast",
  broadcast_and_wait: "event_broadcastandwait",
  wait: "control_wait",
  repeat: "control_repeat",
  forever: "control_forever",
  if: "control_if",
  if_else: "control_if_else",
  wait_until: "control_wait_until",
  repeat_until: "control_repeat_until",
  stop: "control_stop",
  create_clone: "control_create_clone_of",
  delete_this_clone: "control_delete_this_clone",
  touching_object: "sensing_touchingobject",
  touching_color: "sensing_touchingcolor",
  distance_to: "sensing_distanceto",
  ask_and_wait: "sensing_askandwait",
  key_pressed: "sensing_keypressed",
  mouse_down: "sensing_mousedown",
  mouse_x: "sensing_mousex",
  mouse_y: "sensing_mousey",
  timer: "sensing_timer",
  reset_timer: "sensing_resettimer",
  username: "sensing_username",
  add: "operator_add",
  subtract: "operator_subtract",
  multiply: "operator_multiply",
  divide: "operator_divide",
  random: "operator_random",
  greater_than: "operator_gt",
  less_than: "operator_lt",
  equals: "operator_equals",
  join: "operator_join",
  letter_of: "operator_letter_of",
  length: "operator_length",
  contains: "operator_contains",
  mod: "operator_mod",
  round: "operator_round",
  set_variable: "data_setvariableto",
  change_variable: "data_changevariableby",
  show_variable: "data_showvariable",
  hide_variable: "data_hidevariable",
  add_to_list: "data_addtolist",
  delete_of_list: "data_deleteoflist",
  delete_all_of_list: "data_deletealloflist",
  insert_at_list: "data_insertatlist",
  replace_item_of_list: "data_replaceitemoflist",
  item_of_list: "data_itemoflist",
  item_num_of_list: "data_itemnumoflist",
  length_of_list: "data_lengthoflist",
  list_contains_item: "data_listcontainsitem",
  show_list: "data_showlist",
  hide_list: "data_hidelist"
};

export function resolveOpcode(opcodeOrAlias: string): string {
  const trimmed = opcodeOrAlias.trim();
  return ALIASES[trimmed] ?? trimmed;
}

export function getOpcodeSpec(opcodeOrAlias: string): OpcodeSpec | undefined {
  return BLOCK_REGISTRY[resolveOpcode(opcodeOrAlias)];
}

export function isMenuOpcode(opcodeOrAlias: string): boolean {
  return getOpcodeSpec(opcodeOrAlias)?.shape === "menu";
}

export function isHatOpcode(opcodeOrAlias: string): boolean {
  return getOpcodeSpec(opcodeOrAlias)?.shape === "hat";
}

export function isCapOpcode(opcodeOrAlias: string): boolean {
  return getOpcodeSpec(opcodeOrAlias)?.shape === "cap";
}

export function isValueOpcode(opcodeOrAlias: string): boolean {
  const shape = getOpcodeSpec(opcodeOrAlias)?.shape;
  return shape === "reporter" || shape === "boolean";
}

export interface BlockCatalogEntry {
  opcode: string;
  shape: BlockShape;
  category: string;
  description: string;
  inputs: Array<{ name: string; kind: InputKind; default?: string | number; menu?: string }>;
  fields: Array<{ name: string; default: string; kind: FieldKind; options?: readonly string[] }>;
  substacks: string[];
  turboWarpOnly: boolean;
  aliases: string[];
}

export function blockCatalog(): BlockCatalogEntry[] {
  const aliasesByOpcode = new Map<string, string[]>();
  for (const [alias, opcode] of Object.entries(ALIASES)) {
    const list = aliasesByOpcode.get(opcode) ?? [];
    list.push(alias);
    aliasesByOpcode.set(opcode, list);
  }
  return ALL_SPECS.filter((entry) => entry.shape !== "menu").map((entry) => ({
    opcode: entry.opcode,
    shape: entry.shape,
    category: entry.category,
    description: entry.description,
    inputs: entry.inputs.map((item) => ({
      name: item.name,
      kind: item.kind,
      ...(item.default !== undefined ? { default: item.default } : {}),
      ...(item.menu ? { menu: item.menu } : {})
    })),
    fields: entry.fields.map((item) => ({
      name: item.name,
      default: item.default,
      kind: item.kind ?? "plain",
      ...(item.options ? { options: item.options } : {})
    })),
    substacks: entry.substacks,
    turboWarpOnly: entry.turboWarpOnly === true,
    aliases: aliasesByOpcode.get(entry.opcode) ?? []
  }));
}
