import prompts from "prompts";
import { save_to_file } from "./save-to-file.mjs";

/**
 * Interactive CLI JSON editor (objects + arrays)
 */
export async function navigate_object(initial_name = "Object", file_path, default_value = {}) {
  let root = structuredClone(default_value);
  let current_path = [];

  const on_cancel = () => {
    console.log("\nCancelled by user");
    process.exit(1);
  };

  const get_current = () =>
    current_path.reduce((acc, key) => acc[key], root);

  const parse_value = (val) => {
    try {
      return JSON.parse(val);
    } catch {
      return val;
    }
  };

  while (true) {
    const current = get_current();
    const is_arr = Array.isArray(current);
    const keys = is_arr ? [] : Object.keys(current);

    console.clear();
    console.log(`Editing ${initial_name}`);
    console.log(`current_path: ${current_path.join(".") || "root"}\n`);

    console.log("Full structure:");
    console.dir(root, { depth: null, colors: true });
    console.log("");

    let choices = [];

    // ========================
    // ARRAY MODE
    // ========================
    if (is_arr) {
      choices = [
        { title: "Next", value: { type: "done" } },
        ...current.map((item, i) => ({
          title: format_array_item(i, item),
          value: { type: "index", index: i },
        })),
        { title: "➕ Add item", value: { type: "add-item" } },
        ...(current.length
          ? [{ title: "❌ Delete item", value: { type: "delete-item" } }]
          : []),
        ...(current_path.length
          ? [{ title: "⬅ Previous", value: { type: "back" } }]
          : []),
        { title: "💾 Save as default ", value: { type: "save-default" } }
      ];
    }

    // ========================
    // OBJECT MODE
    // ========================
    else {
      choices = [
        { title: "Next", value: { type: "done" } },
        ...keys.map((k) => ({
          title: format_key(k, current[k]),
          value: { type: "key", key: k },
        })),
        { title: "➕ Add key", value: { type: "add" } },
        ...(keys.length
          ? [{ title: "❌ Delete key", value: { type: "delete" } }]
          : []),
        ...(current_path.length
          ? [{ title: "⬅ Previous", value: { type: "back" } }]
          : []),
        { title: "💾 Save as default ", value: { type: "save-default" } }
      ];
    }

    const { action } = await prompts(
      {
        type: "select",
        name: "action",
        message: "Select",
        choices,
      },
      { onCancel: on_cancel }
    );

    if (!action) on_cancel();

    // ========================
    // ARRAY HANDLING
    // ========================
    if (is_arr) {
      if (action.type === "index") {
        const value = current[action.index];

        if (is_object(value) || Array.isArray(value)) {
          current_path.push(action.index);
        } else {
          const { new_value } = await prompts(
            {
              type: "text",
              name: "new_value",
              message: `Edit [${action.index}]`,
              initial: JSON.stringify(value),
            },
            { onCancel: on_cancel }
          );

          current[action.index] = parse_value(new_value);
        }
      }

      else if (action.type === "add-item") {
        const { value } = await prompts(
          {
            type: "text",
            name: "value",
            message: "New item (JSON supported)",
          },
          { onCancel: on_cancel }
        );

        current.push(parse_value(value));
      }

      else if (action.type === "delete-item") {
        const { index } = await prompts(
          {
            type: "select",
            name: "index",
            message: "Delete which item?",
            choices: [
                ...current.map((_, i) => ({
                    title: `[${i}]`,
                    value: i,
                })),
                { title: "Cancel", value: undefined }
            ],
          },
          { onCancel: on_cancel }
        );

        if (index !== undefined) {
          current.splice(index, 1);
        }
      }
    }

    // ========================
    // OBJECT HANDLING
    // ========================
    else {
      if (action.type === "key") {
        const value = current[action.key];

        if (is_object(value) || Array.isArray(value)) {
          current_path.push(action.key);
        } else {
          const { new_value } = await prompts(
            {
              type: "text",
              name: "new_value",
              message: `Edit "${action.key}"`,
              initial: JSON.stringify(value),
            },
            { onCancel: on_cancel }
          );

          current[action.key] = parse_value(new_value);
        }
      }

      else if (action.type === "add") {
        const { key } = await prompts(
          {
            type: "text",
            name: "key",
            message: "Key name",
          },
          { onCancel: on_cancel }
        );

        if (!key) continue;

        const { value } = await prompts(
          {
            type: "text",
            name: "value",
            message: "Value (JSON supported)",
          },
          { onCancel: on_cancel }
        );

        current[key] = parse_value(value);
      }

      else if (action.type === "delete") {
        const { key } = await prompts(
          {
            type: "select",
            name: "key",
            message: "Delete which key?",
            choices: [
                ...keys.map((k) => ({ title: k, value: k })),
                { title: "Cancel", value: null }
            ],
          },
          { onCancel: on_cancel }
        );

        if (!key) continue;

        delete current[key];
      }
    }

    // ========================
    // SHARED
    // ========================
    if (action.type === "back") {
      current_path.pop();
    }

    if (action.type === "done") {
      return { result: root, previous: false };
    }

    if (action.type === "save-default") {
      let resolved_path = await save_to_file(root, file_path)
      console.log(`Saved as default: ${resolved_path}`);
      await new Promise((r) => setTimeout(r, 1000)); // pause to show message
    }
  }
}

// ------------------------
// Helpers
// ------------------------

function is_object(v) {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function format_key(key, value) {
  if (Array.isArray(value)) return `📚 ${key} (${value.length})`;
  if (is_object(value)) return `📂 ${key}`;
  return `📄 ${key}: ${JSON.stringify(value)}`;
}

function format_array_item(i, value) {
  if (Array.isArray(value)) return `📚 [${i}] (${value.length})`;
  if (is_object(value)) return `📂 [${i}]`;
  return `📄 [${i}]: ${JSON.stringify(value)}`;
}