import type { ActionRequest, GuardViolation, MutationClass } from '../types.js';

/**
 * Classifies an ActionRequest into one or more MutationClasses.
 *
 * Classification is NEVER solely based on raw command text —
 * it uses structured fields (httpMethod, gitOperation, tool, operation)
 * with command/args pattern matching as a secondary signal.
 *
 * Fail-closed: when classification is ambiguous, 'UNKNOWN' is added.
 * The policy engine treats UNKNOWN as REQUIRE_APPROVAL.
 */
export class ActionClassifier {
  public classify(request: ActionRequest): readonly MutationClass[] {
    const classes = new Set<MutationClass>();

    this.classifyByTool(request, classes);
    this.classifyByHttpMethod(request, classes);
    this.classifyByGitOperation(request, classes);
    this.classifyByCommand(request, classes);
    this.classifyByResource(request, classes);
    this.classifyByEnvironment(request, classes);

    // If nothing was classified, fail-closed
    if (classes.size === 0) classes.add('UNKNOWN');

    return [...classes];
  }

  // ─── Tool-level classification ────────────────────────────────────────────

  private classifyByTool(request: ActionRequest, out: Set<MutationClass>): void {
    const tool = request.tool.toLowerCase();
    const op = request.operation.toLowerCase();

    if (tool === 'filesystem' || tool === 'sandbox-filesystem') {
      if (op.includes('read')) out.add('READ_ONLY');
      else if (op.includes('write') || op.includes('delete') || op.includes('mkdir')) {
        out.add('LOCAL_MUTATION');
        // If writing to source file paths
        if (this.isSourcePath(request.resource)) out.add('SOURCE_MUTATION');
      }
      return;
    }

    if (tool === 'shell' || tool === 'exec') {
      // Defer to command classifier
      return;
    }

    if (tool === 'git') {
      // Defer to git operation classifier
      return;
    }

    if (tool === 'http' || tool === 'fetch') {
      // Defer to HTTP method classifier
      return;
    }

    if (tool === 'database' || tool === 'prisma' || tool === 'psql' || tool === 'sql') {
      this.classifyDatabaseOperation(op, out);
      return;
    }

    if (tool === 'llm' || tool === 'openai' || tool === 'claude') {
      // LLM calls are read-only in terms of local system mutations
      // (they may produce content that requires downstream policy checks)
      out.add('READ_ONLY');
      return;
    }
  }

  // ─── HTTP method classification ───────────────────────────────────────────

  private classifyByHttpMethod(request: ActionRequest, out: Set<MutationClass>): void {
    const method = request.httpMethod;
    if (!method) return;

    const resource = request.resource.toLowerCase();
    const env = request.environment;

    if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') {
      if (env === 'PRODUCTION') out.add('PRODUCTION_READ');
      else out.add('READ_ONLY');
    } else {
      // POST / PUT / PATCH / DELETE — state-changing by default
      if (env === 'PRODUCTION') out.add('PRODUCTION_MUTATION');
      else out.add('LOCAL_MUTATION');

      // Special semantic cases — method alone is insufficient
      if (method === 'POST') {
        // Authentication endpoints create sessions (state-changing even on staging)
        if (resource.includes('/auth/') || resource.includes('/login') ||
            resource.includes('/signin') || resource.includes('/token')) {
          out.add('AUTH_SESSION_CREATION');
          out.add('CREDENTIAL_USE');
        }
        // Password reset touches DB and triggers email side effects
        if (resource.includes('/password-reset') || resource.includes('/forgot-password')) {
          out.add('DATABASE_MUTATION');
        }
      }

      if (method === 'DELETE') out.add('DESTRUCTIVE');
    }
  }

  // ─── Git operation classification ─────────────────────────────────────────

  private classifyByGitOperation(request: ActionRequest, out: Set<MutationClass>): void {
    const gitOp = request.gitOperation?.toLowerCase();
    if (!gitOp) return;

    const args = (request.args ?? []).join(' ').toLowerCase();

    switch (gitOp) {
      case 'status':
      case 'log':
      case 'diff':
      case 'show':
      case 'ls-remote':
      case 'rev-parse':
      case 'branch': // read only
        if (!args.includes('-d') && !args.includes('--delete')) out.add('READ_ONLY');
        else out.add('GIT_DESTRUCTIVE');
        break;
      case 'add': {
        // `git add .` / `git add -A` / `git add --all` are DENIED globally
        const rawArgs = request.args ?? [];
        const isBroadStaging =
          rawArgs.includes('.') ||
          rawArgs.includes('-A') ||
          rawArgs.includes('--all') ||
          rawArgs.some((a) => a === '-a');
        if (isBroadStaging) {
          out.add('GIT_STAGE');
          out.add('UNKNOWN'); // force REQUIRE_APPROVAL for broad staging
        } else {
          out.add('GIT_STAGE');
        }
        break;
      }
      case 'commit':
        out.add('GIT_COMMIT');
        break;
      case 'push':
        out.add('GIT_PUSH');
        if (args.includes('--force') || args.includes('-f')) {
          out.add('GIT_DESTRUCTIVE');
        }
        break;
      case 'reset':
        if (args.includes('--hard')) out.add('GIT_DESTRUCTIVE');
        else out.add('LOCAL_MUTATION');
        break;
      case 'clean':
        out.add('GIT_DESTRUCTIVE');
        break;
      case 'fetch':
      case 'ls-files':
        out.add('READ_ONLY');
        break;
      default:
        out.add('LOCAL_MUTATION');
    }
  }

  // ─── Command pattern classification ───────────────────────────────────────

  private classifyByCommand(request: ActionRequest, out: Set<MutationClass>): void {
    const cmd = (request.command ?? '').trim();
    if (!cmd) return;

    // Parse the base command
    const parts = cmd.split(/\s+/);
    const base = parts[0]?.toLowerCase() ?? '';
    const rest = parts.slice(1).join(' ').toLowerCase();

    // Git via shell
    if (base === 'git') {
      const sub = parts[1]?.toLowerCase() ?? '';
      const fakeRequest = { ...request, gitOperation: sub, args: parts.slice(2) };
      this.classifyByGitOperation(fakeRequest, out);
      return;
    }

    // Prisma commands
    if (base === 'prisma' || base === 'npx prisma' || cmd.startsWith('npx prisma') || cmd.startsWith('pnpm prisma')) {
      this.classifyPrismaCommand(rest, out);
      return;
    }

    // Database tools
    if (base === 'psql' || base === 'mysql' || base === 'sqlite3') {
      out.add('DATABASE_READ'); // may also be DATABASE_MUTATION depending on args
      if (rest.includes('drop') || rest.includes('delete') || rest.includes('truncate')) {
        out.add('DATABASE_MUTATION');
        out.add('DESTRUCTIVE');
      }
      return;
    }

    // Deployment commands
    if (base === 'railway' || cmd.includes('railway up') || cmd.includes('railway redeploy')) {
      out.add('DEPLOYMENT');
      return;
    }

    // Secret extraction commands
    if (this.isSecretReadCommand(cmd, base, rest)) {
      out.add('SECRET_READ');
      return;
    }

    // curl / http clients — defer to HTTP classification
    if (base === 'curl' || base === 'wget' || base === 'httpie' || base === 'http') {
      this.classifyCurlCommand(cmd, rest, out);
      return;
    }

    // Node/npx script execution — may be harmful if generated
    if (base === 'node' || base === 'npx' || base === 'tsx' || base === 'ts-node') {
      out.add('LOCAL_MUTATION'); // scripts can have side effects
      return;
    }

    // Write-via-shell (cat > file, tee, etc.)
    if (base === 'cat' && rest.includes('>')) { out.add('LOCAL_MUTATION'); return; }
    if (base === 'tee') { out.add('LOCAL_MUTATION'); return; }
    if (base === 'rm' || base === 'rmdir') { out.add('LOCAL_MUTATION'); out.add('DESTRUCTIVE'); return; }
    if (base === 'mv') { out.add('LOCAL_MUTATION'); return; }
    if (base === 'cp') { out.add('LOCAL_MUTATION'); return; }
    if (base === 'chmod' || base === 'chown') { out.add('LOCAL_MUTATION'); return; }

    // npm/pnpm/yarn install — local mutation
    if (base === 'npm' || base === 'pnpm' || base === 'yarn' || base === 'bun') {
      if (rest.startsWith('install') || rest.startsWith('add') || rest.startsWith('remove') || rest.startsWith('update')) {
        out.add('LOCAL_MUTATION');
      } else {
        out.add('READ_ONLY');
      }
      return;
    }

    // Read-only inspection commands
    if (['cat', 'ls', 'pwd', 'echo', 'head', 'tail', 'wc', 'find', 'grep', 'rg', 'fd',
      'which', 'type', 'file', 'stat', 'du', 'df', 'uname', 'date', 'whoami', 'id'].includes(base)) {
      // cat/grep on secret files is a special case — handled by resource classifier
      out.add('READ_ONLY');
      return;
    }

    // Default: unknown, fail-closed
    out.add('UNKNOWN');
  }

  private classifyPrismaCommand(rest: string, out: Set<MutationClass>): void {
    if (rest.startsWith('db pull')) {
      // Reads DB schema → writes to prisma/schema.prisma
      out.add('DATABASE_READ');
      out.add('SCHEMA_SOURCE_MUTATION'); // source file mutation!
      return;
    }
    if (rest.startsWith('db push')) {
      out.add('DATABASE_MUTATION');
      out.add('SCHEMA_MUTATION');
      return;
    }
    if (rest.startsWith('migrate dev') || rest.startsWith('migrate reset')) {
      out.add('DATABASE_MUTATION');
      out.add('SCHEMA_MUTATION');
      out.add('DESTRUCTIVE');
      return;
    }
    if (rest.startsWith('migrate deploy')) {
      out.add('DATABASE_MUTATION');
      out.add('SCHEMA_MUTATION');
      return;
    }
    if (rest.startsWith('generate')) {
      out.add('LOCAL_MUTATION'); // generates client code
      return;
    }
    if (rest.startsWith('studio')) {
      out.add('PRODUCTION_READ'); // browser UI — may expose data
      return;
    }
    // Unknown prisma subcommand
    out.add('UNKNOWN');
  }

  private classifyCurlCommand(cmd: string, rest: string, out: Set<MutationClass>): void {
    const method = this.extractCurlMethod(cmd, rest);
    const env = this.urlEnvironment(cmd);
    if (method === 'GET' || method === 'HEAD') {
      out.add(env === 'PRODUCTION' ? 'PRODUCTION_READ' : 'READ_ONLY');
    } else {
      out.add(env === 'PRODUCTION' ? 'PRODUCTION_MUTATION' : 'LOCAL_MUTATION');
      if (rest.includes('auth') || rest.includes('login') || rest.includes('token')) {
        out.add('AUTH_SESSION_CREATION');
        out.add('CREDENTIAL_USE');
      }
    }
    // Detect embedded credentials in curl command
    if (rest.includes('-u ') || rest.includes('--user ') ||
        rest.includes('Authorization:') || rest.includes('password')) {
      out.add('CREDENTIAL_USE');
    }
  }

  private extractCurlMethod(cmd: string, rest: string): string {
    const mMatch = cmd.match(/-X\s+(\w+)/i) ?? cmd.match(/--request\s+(\w+)/i);
    if (mMatch && mMatch[1]) return mMatch[1].toUpperCase();
    if (rest.includes('--data') || rest.includes('-d ')) return 'POST';
    return 'GET';
  }

  private urlEnvironment(cmd: string): 'PRODUCTION' | 'LOCAL' {
    // Very rough heuristic — production URLs contain real domains (not localhost/127.0.0.1)
    if (cmd.includes('localhost') || cmd.includes('127.0.0.1') || cmd.includes('0.0.0.0')) {
      return 'LOCAL';
    }
    return 'PRODUCTION';
  }

  // ─── Resource classification ──────────────────────────────────────────────

  private classifyByResource(request: ActionRequest, out: Set<MutationClass>): void {
    const resource = request.resource.toLowerCase();

    // Secret-bearing file detection
    if (this.isSecretBearingPath(resource)) {
      out.add('SECRET_READ');
    }

    // Detect access to secret env variables in command params
    const cmd = ((request.command ?? '') + ' ' + (request.args ?? []).join(' ')).toLowerCase();
    if (SECRET_VARIABLE_PATTERNS.some((p) => p.test(cmd))) {
      out.add('SECRET_READ');
    }
  }

  private classifyByEnvironment(request: ActionRequest, out: Set<MutationClass>): void {
    // Upgrade LOCAL_MUTATION to PRODUCTION_MUTATION when environment is PRODUCTION
    if (request.environment === 'PRODUCTION' && out.has('LOCAL_MUTATION')) {
      out.delete('LOCAL_MUTATION');
      out.add('PRODUCTION_MUTATION');
    }
  }

  // ─── Database operation helper ────────────────────────────────────────────

  private classifyDatabaseOperation(op: string, out: Set<MutationClass>): void {
    if (op.includes('select') || op.includes('read') || op.includes('find') || op.includes('get')) {
      out.add('DATABASE_READ');
    } else if (op.includes('migrate') || op.includes('schema')) {
      out.add('SCHEMA_MUTATION');
      out.add('DATABASE_MUTATION');
    } else {
      out.add('DATABASE_MUTATION');
    }
  }

  // ─── Secret read command detection ───────────────────────────────────────

  private isSecretReadCommand(cmd: string, base: string, rest: string): boolean {
    // printenv / env dump
    if (base === 'printenv' || base === 'env') return true;
    // echo of secret variables
    if (base === 'echo' && SECRET_VARIABLE_PATTERNS.some((p) => p.test(rest))) return true;
    // railway variables / secrets
    if (cmd.includes('railway variables') || cmd.includes('railway secrets')) return true;
    // cat on secret files
    if (base === 'cat' && this.isSecretBearingPath(rest)) return true;
    // grep for known secret patterns in secret files
    if ((base === 'grep' || base === 'rg') && this.hasSecretSearchPattern(rest) && this.containsSecretPath(rest)) return true;
    // awk/sed extracting from secret files
    if ((base === 'awk' || base === 'sed') && this.containsSecretPath(rest)) return true;
    return false;
  }

  private isSecretBearingPath(path: string): boolean {
    return SECRET_BEARING_PATH_PATTERNS.some((p) => p.test(path));
  }

  private hasSecretSearchPattern(text: string): boolean {
    return SECRET_VARIABLE_PATTERNS.some((p) => p.test(text));
  }

  private containsSecretPath(text: string): boolean {
    return SECRET_BEARING_PATH_PATTERNS.some((p) => p.test(text));
  }

  private isSourcePath(path: string): boolean {
    return /\.(ts|js|tsx|jsx|mjs|cjs|json|yaml|yml|prisma|sql|sh|env\.example)$/.test(path) &&
      !path.includes('node_modules') &&
      !path.includes('/dist/');
  }
}

// ─── Guard: Secret File Read ──────────────────────────────────────────────────

export class SecretFileGuard {
  public check(request: ActionRequest): GuardViolation | null {
    const resource = request.resource.toLowerCase();
    const cmd = (request.command ?? '').toLowerCase();
    const args = (request.args ?? []).join(' ').toLowerCase();
    const combined = `${cmd} ${args} ${resource}`.trim();

    // Check direct secret-bearing path access
    if (SECRET_BEARING_PATH_PATTERNS.some((p) => p.test(combined))) {
      return {
        guardName: 'SecretFileGuard',
        ruleCode: 'SECRET_FILE_READ',
        detail: `Access to secret-bearing resource detected: "${request.resource}"`,
      };
    }

    // Check grep/awk/sed for secret variable names in env files
    const base = (request.command ?? '').split(/\s+/)[0]?.toLowerCase() ?? '';
    if (['grep', 'rg', 'awk', 'sed'].includes(base)) {
      const hasSecretSearch = SECRET_VARIABLE_PATTERNS.some((p) => p.test(combined));
      const hasSecretPath = SECRET_BEARING_PATH_PATTERNS.some((p) => p.test(combined));
      if (hasSecretSearch && hasSecretPath) {
        return {
          guardName: 'SecretFileGuard',
          ruleCode: 'SECRET_FILE_READ',
          detail: `Secret variable extraction from env file detected in: "${request.command}"`,
        };
      }
    }

    return null;
  }
}

// ─── Guard: Secret Output ─────────────────────────────────────────────────────

export class SecretOutputGuard {
  public check(request: ActionRequest): GuardViolation | null {
    const cmd = (request.command ?? '').toLowerCase();
    const args = (request.args ?? []).join(' ').toLowerCase();
    const combined = `${cmd} ${args}`.trim();

    // printenv / env dumps
    const base = combined.split(/\s+/)[0] ?? '';
    if (base === 'printenv' || base === 'env') {
      return {
        guardName: 'SecretOutputGuard',
        ruleCode: 'SECRET_OUTPUT_ENV_DUMP',
        detail: `Environment dump command would expose secret values: "${combined}"`,
      };
    }

    // echo of known secret variables
    if (base === 'echo' && SECRET_VARIABLE_PATTERNS.some((p) => p.test(combined))) {
      return {
        guardName: 'SecretOutputGuard',
        ruleCode: 'SECRET_OUTPUT_ECHO',
        detail: `Echo of secret variable detected: "${combined}"`,
      };
    }

    // railway variables
    if (combined.includes('railway variables') || combined.includes('railway secrets')) {
      return {
        guardName: 'SecretOutputGuard',
        ruleCode: 'SECRET_OUTPUT_RAILWAY_VARS',
        detail: `Railway variables/secrets dump would expose production secrets`,
      };
    }

    return null;
  }
}

// ─── Guard: Secret Literal ────────────────────────────────────────────────────

export class SecretLiteralGuard {
  public check(request: ActionRequest): GuardViolation | null {
    // Check generated content (before file write or script execution)
    const content = request.generatedContent ?? '';
    const cmd = request.command ?? '';

    const combined = `${content}\n${cmd}`;
    const violation = this.detectLiterals(combined);
    if (violation) return violation;

    // Check command args for embedded credentials
    const args = (request.args ?? []).join(' ');
    const argsViolation = this.detectLiterals(args);
    if (argsViolation) return argsViolation;

    // Check parameters
    for (const [key, value] of Object.entries(request.parameters)) {
      if (typeof value === 'string') {
        const paramViolation = this.detectLiterals(`${key}=${value}`);
        if (paramViolation) return paramViolation;
      }
    }

    return null;
  }

  private detectLiterals(text: string): GuardViolation | null {
    for (const pattern of SECRET_LITERAL_PATTERNS) {
      if (pattern.test(text)) {
        return {
          guardName: 'SecretLiteralGuard',
          ruleCode: 'SECRET_LITERAL_DETECTED',
          detail: `Credential literal detected in action content. Pattern: ${pattern.source.substring(0, 40)}...`,
        };
      }
    }
    return null;
  }
}

// ─── Guard: Auth Credential Script ───────────────────────────────────────────

/**
 * Detects the Synterra pattern:
 *   agent generated JS file → embedded production email/password → executed script
 *
 * Any generated source/script containing credential material intended
 * for real production authentication is denied unless explicitly authorized
 * through a secure credential mechanism.
 */
export class AuthCredentialScriptGuard {
  public check(request: ActionRequest): GuardViolation | null {
    const content = request.generatedContent ?? '';
    if (!content) return null;

    // Detect auth credential patterns in generated content
    const hasAuthPattern = AUTH_CREDENTIAL_PATTERNS.some((p) => p.test(content));
    if (hasAuthPattern) {
      return {
        guardName: 'AuthCredentialScriptGuard',
        ruleCode: 'AUTH_CREDENTIAL_IN_GENERATED_CONTENT',
        detail:
          'Generated content contains authentication credentials (email/password/token literal). ' +
          'Use a secure secret-channel mechanism instead of embedding credentials.',
      };
    }

    return null;
  }
}

// ─── Pattern Libraries ────────────────────────────────────────────────────────

const SECRET_BEARING_PATH_PATTERNS: RegExp[] = [
  // .env anywhere in string (as standalone token, not inside longer filenames)
  /(?:^|[\s/])\.env(?:\s|$)/i,
  // .env.production, .env.local etc.
  /\.env\.\w+/i,
  // **/  .env
  /\*\*\/\.env/i,
  // /.env (path separator)
  /\/\.env/i,
  /secrets?\.(json|yaml|yml|toml)/i,
  /credentials?\.(json|yaml|yml)/i,
  // private key files
  /private\.key(?:\s|$)/i,
  /\.pem(?:\s|$)/i,
  /\.pfx(?:\s|$)/i,
  /\.p12(?:\s|$)/i,
  /keystore/i,
  /serviceaccount/i,
];

const SECRET_VARIABLE_PATTERNS: RegExp[] = [
  /DATABASE_URL/i,
  /JWT_SECRET/i,
  /API_KEY/i,
  /SECRET_KEY/i,
  /PRIVATE_KEY/i,
  /ACCESS_TOKEN/i,
  /REFRESH_TOKEN/i,
  /SESSION_SECRET/i,
  /ENCRYPTION_KEY/i,
  /OPENAI_API_KEY/i,
  /ANTHROPIC_API_KEY/i,
  /RAILWAY_TOKEN/i,
  /GITHUB_TOKEN/i,
  /STRIPE_SECRET/i,
  /SENDGRID_API_KEY/i,
  /SMTP_PASSWORD/i,
  /\$\w*(TOKEN|SECRET|PASSWORD|KEY|CREDENTIAL)\w*/i,
];

const SECRET_LITERAL_PATTERNS: RegExp[] = [
  // postgres connection strings with credentials
  /postgres(?:ql)?:\/\/[^@\s]+:[^@\s]+@/i,
  // mysql connection strings
  /mysql:\/\/[^@\s]+:[^@\s]+@/i,
  // redis with auth
  /redis:\/\/:[^@\s]+@/i,
  // Bearer token literals (not env var references)
  /Authorization:\s*Bearer\s+[A-Za-z0-9\-._~+/]+=*/i,
  // Basic auth
  /Authorization:\s*Basic\s+[A-Za-z0-9+/]+=*/i,
  // Curl -u user:password
  /curl\s+.*-u\s+[^$\s]+:[^$\s]+/i,
  // password: 'literal_value' (not env ref)
  /password\s*[:=]\s*['"][^'"$]{4,}['"]/i,
  // secret: 'literal_value'
  /secret\s*[:=]\s*['"][^'"$]{8,}['"]/i,
  // API key patterns (long alphanumeric strings in key context)
  /(?:api[_-]?key|apikey)\s*[:=]\s*['"][A-Za-z0-9\-_]{20,}['"]/i,
  // Private key blocks
  /-----BEGIN\s+(?:RSA|EC|PRIVATE|ENCRYPTED)\s+PRIVATE\s+KEY-----/i,
];

const AUTH_CREDENTIAL_PATTERNS: RegExp[] = [
  // email + password combination (Synterra incident pattern)
  /email\s*[:=]\s*['"][^'"]{3,}['"]\s*[,;]?\s*\n?.*password\s*[:=]/im,
  // password literal in auth context
  /(?:login|signin|auth|authenticate)\s*\([^)]*password\s*[:=]\s*['"][^'"$]{4,}['"]/im,
  // fetch/axios with auth body containing password literal
  /(?:fetch|axios|request|got)\s*\([^)]*body.*password\s*[:=]\s*['"][^'"$]{4,}['"]/ims,
  // POST /auth with credentials
  /POST\s+['"/].*auth.*['"].*password\s*[:=]/im,
  ...SECRET_LITERAL_PATTERNS,
];

// Re-export guards for convenience
export { type GuardViolation };
