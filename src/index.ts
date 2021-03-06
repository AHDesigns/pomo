import { IArg } from '@oclif/parser/lib/args';
import { promises as fs, constants } from 'fs';
import { flags as f } from '@oclif/command';
import {Command} from '@oclif/command'
import execa from 'execa';
import os from 'os';
import alert from 'node-notifier';

type Config = {
  slack: string;
  timer: number;
};

const delay = (milliseconds: number) => new Promise(resolve => setTimeout(resolve, milliseconds));

class Pomo extends Command {
  static description = 'start a pomodoro timer';

  public configPath = `${os.homedir()}/.pomo-timer.json`

  private tokens: Partial<Config> = {};

  static flags = {
    complete: f.boolean({ char: 'c' }),
    init: f.string({ char: 'i', description: 'where init is your slack token from https://api.slack.com/custom-integrations/legacy-tokens' }),
  };

  static args: IArg[] = [
    { name: 'minutes',
      required: false,
      description: 'number of minutes for pomodoro timer',
      default: '25',
    }
  ]

  private execaOptions: execa.Options = { cwd: os.homedir() };

  async run() {
    const { flags, args } = this.parse(Pomo);

    const { minutes } = args;

    if (flags.init) {
      await this.envsSet({ slack: flags.init });
      this.log(`✓ config created at ${this.configPath}`);
      this.exit(0);
    }

    this.tokens = await this.envs();
    if (this.tokens.slack === 'add your token here') {
      this.log('tokens have not been set up correctly')
      this.log('please use `--init` flag.')
      this.log('see `--help` for details')
      this.exit(1);
    }

    if (flags.complete) {
      await this.end();
      this.exit(0);
    }

    this.log('starting new pomo timer');

    let timer:any;
    let mins = parseInt(minutes);
    if (isNaN(mins)) {
      this.error(`argument "minutes" must be a number, you passed: ${minutes}`);
    }

    await this.envsSet({ timer: mins });
    await this.slackStatus(`free in ${mins} mins`, ':tomato:');
    await this.slackPresence('away');
    await this.slackSnooze(mins);

    timer = setInterval(async () => {
      mins--
      this.log('timer: ', mins)
      if (mins < 1) {
        await this.end();
        clearInterval(timer)
      } else {
        await this.envsSet({ timer: mins });
        await this.slackStatus(`free in ${mins} mins`, ':tomato:');
      }
    }, 60000);
  }

  async slackStatus(message: string, emoji: string) {
    await this.shell(
      `SLACK_CLI_TOKEN=${this.tokens.slack} slack status edit --text "${message}" --emoji '${emoji}'`,
      false,
      { shell: true },
    );
  }

  async slackPresence(active: 'active' | 'away') {
    await this.shell(
      `SLACK_CLI_TOKEN=${this.tokens.slack} slack presence ${active}`,
      false,
      { shell: true },
    );
  }

  async slackSnooze(mins: number) {
    await this.shell(
      mins === 0
      ? `SLACK_CLI_TOKEN=${this.tokens.slack} slack snooze end`
      : `SLACK_CLI_TOKEN=${this.tokens.slack} slack snooze start --minutes ${mins}`,
      false,
      { shell: true },
    );
  }

  async end() {
    this.log('stopping')

    alert.notify('Timer Done!');
    await this.shell(`afplay /System/Library/Sounds/Glass.aiff`)
    await this.slackStatus('free', ':pickle_rick:');
    await this.slackPresence('active');
    try {
      await this.slackSnooze(0);
    } catch (e) {
      // ignore
    }
    await this.envsSet({ timer: 0 });
  }

  async shell(cmd: string, pipeOutput = true, optionOverides?: execa.Options) {
    const currentOptions = { ...this.execaOptions };

    const options = {
      ...currentOptions,
      ...optionOverides,
    };

    const subprocess = execa.command(cmd, options);
    if (pipeOutput) {
      subprocess.stdout.pipe(process.stdout);
    }
    const res = await subprocess;
    return res;
  }

  async envs(): Promise<Config> {
    try {
      const config = await fs.readFile(this.configPath);
      const json = config.toString();
      return JSON.parse(json);
    } catch (e) {
      if (e.code === 'ENOENT') {
        const newConfig: Config = {
          slack: 'add your token here',
          timer: 0,
        };

        return newConfig;
      }
      throw e;
    }
  }

  async envsSet(envs: Partial<Config>): Promise<Config> {
    const currentEnvs = await this.envs();
    const newEnvs = {
      ...currentEnvs,
      ...envs,
    };

    await fs.writeFile(this.configPath, JSON.stringify(newEnvs, null, 2));
    return newEnvs;
  }
}

export = Pomo
