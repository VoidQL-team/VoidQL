#!/usr/bin/env node

import { spawn } from 'child_process';
import { select } from './db-select.mjs';
import { build_object } from './object-builder.mjs';
import { create_connection } from './db-connection.mjs';
import default_user from '../saved/user.mjs'
import default_structure from '../saved/structure.mjs'
import default_query from '../saved/query.mjs'
import user_role from '../saved/user_role.mjs'
import { navigate_object } from './object-navigator-editor.mjs';
import prompts from 'prompts';
import { save_to_file } from './save-to-file.mjs';
async function main() {
  let back = false;

  const test = await prompts(
    {
      type: 'select',
      name: 'type',
      message: 'Select the type of test:',
      choices: [
        { title: 'Auto running default tests', value: 'default' },
        { title: 'Custom test', value: 'custom' },
        { title: 'Exit', value: null }
      ]
    },
      {
      onCancel: () => {
          console.log('\nCancelled');
          process.exit(1);
      }
    }
  );
  let db_select = await select()
  let db = await create_connection(db_select);

  const user_type = await prompts(
    {
      type: 'text',
      name: 'role',
      message: 'Select the user type:',
      initial: user_role
    },
    {
      onCancel: () => {
          console.log('\nCancelled');
          process.exit(1);
      }
    }
  )

  await save_to_file(user_type.role, '../saved/user_role.mjs')

  const { result: user, go_back_to_select } = await build_object('User body', '../saved/user.mjs', default_user);
  if (go_back_to_select) {
    return
  }

  const env = {
    ...process.env,
    DB_HOST:db.db_address,
    DB_USER:db.user_name,
    DB_FAMILY: db_select.family,
    DB_PWD:db.password,
    DB_NAME:db.db_name,
    USER_OBJ: JSON.stringify(user),
    USER_ROLE: user_type.role,
  }

  if(test.type == 'custom') {
    //Create db connection
    do{
      
      const { result: query, go_back_to_user } = await navigate_object('Query Body', '../saved/query.mjs', default_query);
      if (go_back_to_user) {
        back = true;
        continue;
      }

      const { result: structure, go_back_to_query } = await navigate_object('Policy Structure', '../saved/structure.mjs', default_structure);
        if (go_back_to_query) {
          back = true;
          continue;
      }

      // Run Vitest
      const child = spawn('npx', ['vitest', 'run', 'custom'], {
        stdio: 'inherit',
        env: {
          ...process.env,
          ...env,
          STRUCTURE_OBJ: JSON.stringify(structure),
          STRUCTURE_QUERY: JSON.stringify(query),
        }
      });

      child.on('exit', (code) => {
        process.exit(code ?? 0);
      });
    } while (back);
  }else if(test.type == 'default') {
    const run_mode = await prompts(
      {
        type: 'select',
        name: 'mode',
        message: 'Select the running mode:',
        choices: [
          { title: 'Sequential', value: 'sequential' },
          { title: 'Parallel', value: 'parallel' },
          { title: 'Exit', value: null }
        ]
      },
      {
        onCancel: () => {
            console.log('\nCancelled');
            process.exit(1);
        }
      }
    )

    env.RUN_MODE = run_mode.mode
    const child = spawn('npx', ['vitest', 'run', 'auto'], {
      stdio: 'inherit',
      env: {
        ...process.env,
        ...env,
      }
    });

    child.on('exit', (code) => {
      process.exit(code ?? 0);
    });
  }
}

main();