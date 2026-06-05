import { runChecked } from "../command-runner";

type RunChecked = typeof runChecked;

export interface MacOSGUIEnvironmentServiceDependencies {
  runChecked?: RunChecked;
}

export class MacOSGUIEnvironmentService {
  private readonly runChecked: RunChecked;

  constructor(dependencies: MacOSGUIEnvironmentServiceDependencies = {}) {
    this.runChecked = dependencies.runChecked ?? runChecked;
  }

  async setEnvironmentVariable(name: string, value: string): Promise<{ warning?: string }> {
    await this.runChecked("/bin/launchctl", ["setenv", name, value], {
      errorPrefix: `Failed to set ${name} for GUI applications`,
      maxOutputBytes: 8 * 1024,
      timeoutMs: 5_000
    });
    return {};
  }
}
