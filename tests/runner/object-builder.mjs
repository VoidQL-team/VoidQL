import prompts from 'prompts';
import { save_to_file } from './save-to-file.mjs';

/**
 * Build a dynamic JSON object using prompts.
 * Shows current object and allows adding attributes.
 * Handles Ctrl+C / cancellation gracefully.
 * Supports "Save as default" to a file.
 */
export async function build_object(initial_name = 'Object', default_file_path = null, default_value = {}) {
  let result = { ...default_value };
  let done = false;

  const on_cancel = () => {
    console.log('\nCancelled by user');
    process.exit(1);
  };

  while (!done) {
    // Display current object
    console.clear();
    console.log(`Current ${initial_name}:`);
    console.log(JSON.stringify(result, null, 2));
    console.log('');

    // Menu options
    const { action } = await prompts(
      {
        type: 'select',
        name: 'action',
        message: 'Choose action',
        choices: [
          { title: 'Next', value: 'next' },
          { title: 'Previous', value: 'previous' },
          { title: '➕ Add a new attribute', value: 'add' },
          { title: '✏️ Edit existing attribute', value: 'edit' },
          { title: '❌ Delete attribute', value: 'delete' },
          { title: '💾 Save as default', value: 'save-default' }
        ]
      },
      { onCancel: on_cancel }
    );

    if (!action) on_cancel();

    if (action === 'add') {
      const { key } = await prompts({ type: 'text', name: 'key', message: 'Enter the key' }, { onCancel: on_cancel });
      if (!key) continue;
      const { value } = await prompts({ type: 'text', name: 'value', message: `Enter the value for "${key}"` }, { onCancel: on_cancel });
      result[key] = value;

    } else if (action === 'edit') {
      const { key } = await prompts({ type: 'text', name: 'key', message: 'Enter the key to edit' }, { onCancel: on_cancel });
      if (!key || !(key in result)) continue;
      const { value } = await prompts({ type: 'text', name: 'value', message: `Enter the new value for "${key}"` }, { onCancel: on_cancel });
      result[key] = value;

    } else if (action === 'delete') {
      const { key } = await prompts(
        {
          type: 'select',
          name: 'key',
          message: 'Select the key to delete',
          choices: [...Object.keys(result).map((k) => ({ title: k, value: k })), { title: 'Cancel', value: null }]
        },
        { onCancel: on_cancel }
      );
      if (!key || !(key in result)) continue;
      delete result[key];

    } else if (action === 'save-default') {
      if (!default_file_path) {
        console.log('No default file path provided.');
        continue;
      }
      let resolved_path = await save_to_file(result, default_file_path)
      console.log(`Saved as default: ${resolved_path}`);
      await new Promise((r) => setTimeout(r, 1000)); // pause to show message

    } else if (action === 'next') {
      done = true;

    } else if (action === 'previous') {
      return { result, previous: true };
    }
  }

  return { result, previous: false };
}