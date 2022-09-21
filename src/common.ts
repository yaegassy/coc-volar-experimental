import { commands, DocumentSelector, ExtensionContext, LanguageClient, Thenable, workspace } from 'coc.nvim';

import * as shared from '@volar/shared';
import { VueServerInitializationOptions } from '@volar/vue-language-server';
import { TextDocumentSyncKind } from 'vscode-languageserver-protocol';

import * as doctor from './client/commands/doctor';
import * as initializeTakeOverMode from './client/commands/initializeTakeOverMode';
import * as scaffoldSnippets from './client/completions/scaffoldSnippets';
import * as statusBar from './client/statusBar';
import * as autoInsertion from './features/autoInsertion';
import * as fileReferences from './features/fileReferences';
import * as reloadProject from './features/reloadProject';
import * as showReferences from './features/showReferences';
import * as tsVersion from './features/tsVersion';
import * as verifyAll from './features/verifyAll';

let apiClient: LanguageClient | undefined;
let docClient: LanguageClient | undefined;
let htmlClient: LanguageClient;

let resolveCurrentTsPaths: {
  serverPath: string;
  localizedPath: string | undefined;
  isWorkspacePath: boolean;
};

type CreateLanguageClient = (
  id: string,
  name: string,
  documentSelector: DocumentSelector,
  initOptions: VueServerInitializationOptions,
  port: number
) => LanguageClient;

let activated: boolean;

export async function activate(context: ExtensionContext, createLc: CreateLanguageClient) {
  /** Custom commands for coc-volar */
  initializeTakeOverMode.register(context);

  //
  // For the first activation event
  //

  if (!activated) {
    const { document } = await workspace.getCurrentState();
    const currentlangId = document.languageId;
    if (currentlangId === 'vue') {
      doActivate(context, createLc);
      activated = true;
    }

    if (
      (!activated && currentlangId === 'markdown' && processMd()) ||
      (!activated && currentlangId === 'html' && processHtml())
    ) {
      doActivate(context, createLc);
      activated = true;
    }

    const takeOverMode = takeOverModeEnabled();
    if (
      !activated &&
      takeOverMode &&
      ['javascript', 'typescript', 'javascriptreact', 'typescriptreact'].includes(currentlangId)
    ) {
      doActivate(context, createLc);
      activated = true;
    }
  }

  //
  // If open another file after the activation event
  //

  workspace.onDidOpenTextDocument(
    async () => {
      if (activated) return;

      const { document } = await workspace.getCurrentState();
      const currentlangId = document.languageId;

      if (currentlangId === 'vue') {
        doActivate(context, createLc);
        activated = true;
      }

      if (
        (!activated && currentlangId === 'markdown' && processMd()) ||
        (!activated && currentlangId === 'html' && processHtml())
      ) {
        doActivate(context, createLc);
        activated = true;
      }

      const takeOverMode = takeOverModeEnabled();

      if (
        !activated &&
        takeOverMode &&
        ['javascript', 'typescript', 'javascriptreact', 'typescriptreact'].includes(currentlangId)
      ) {
        doActivate(context, createLc);
        activated = true;
      }
    },
    null,
    context.subscriptions
  );
}

export async function doActivate(context: ExtensionContext, createLc: CreateLanguageClient) {
  initializeWorkspaceState(context);

  const takeOverMode = takeOverModeEnabled();

  const languageFeaturesDocumentSelector: DocumentSelector = takeOverMode
    ? [
        { scheme: 'file', language: 'vue' },
        { scheme: 'file', language: 'javascript' },
        { scheme: 'file', language: 'typescript' },
        { scheme: 'file', language: 'javascriptreact' },
        { scheme: 'file', language: 'typescriptreact' },
        { scheme: 'file', language: 'json' },
      ]
    : [{ scheme: 'file', language: 'vue' }];

  const documentFeaturesDocumentSelector: DocumentSelector = takeOverMode
    ? [
        { scheme: 'file', language: 'vue' },
        { scheme: 'file', language: 'javascript' },
        { scheme: 'file', language: 'typescript' },
        { scheme: 'file', language: 'javascriptreact' },
        { scheme: 'file', language: 'typescriptreact' },
      ]
    : [{ scheme: 'file', language: 'vue' }];

  if (processHtml()) {
    languageFeaturesDocumentSelector.push({ scheme: 'file', language: 'html' });
    documentFeaturesDocumentSelector.push({ scheme: 'file', language: 'html' });
  }

  if (processMd()) {
    languageFeaturesDocumentSelector.push({ scheme: 'file', language: 'markdown' });
    documentFeaturesDocumentSelector.push({ scheme: 'file', language: 'markdown' });
  }

  const _useSecondServer = useSecondServer();

  [apiClient, docClient, htmlClient] = await Promise.all([
    createLc(
      'volar-language-features',
      'Volar - Language Features Server',
      languageFeaturesDocumentSelector,
      getInitializationOptions(context, 'main-language-features', _useSecondServer),
      6009
    ),
    _useSecondServer
      ? createLc(
          'volar-language-features-2',
          'Volar - Second Language Features Server',
          languageFeaturesDocumentSelector,
          getInitializationOptions(context, 'second-language-features', _useSecondServer),
          6010
        )
      : undefined,
    createLc(
      'volar-document-features',
      'Volar - Document Features Server',
      documentFeaturesDocumentSelector,
      getInitializationOptions(context, 'document-features', _useSecondServer),
      6011
    ),
  ]);

  const clients = [apiClient, docClient, htmlClient].filter(shared.notEmpty);

  registerRestartRequest();
  registerClientRequests();

  reloadProject.register('volar.action.reloadProject', context, [apiClient, docClient].filter(shared.notEmpty));
  /** Custom commands for coc-volar */
  doctor.register(context);
  /** Custom snippets completion for coc-volar */
  scaffoldSnippets.register(context);

  if (apiClient) {
    verifyAll.register(context, docClient ?? apiClient);
    fileReferences.register('volar.vue.findAllFileReferences', docClient ?? apiClient);
    /** Custom status-bar for coc-volar */
    statusBar.register(context, docClient ?? apiClient);

    if (
      workspace.getConfiguration('volar').get<boolean>('autoCreateQuotes') ||
      workspace.getConfiguration('volar').get<boolean>('autoClosingTags') ||
      workspace.getConfiguration('volar').get<boolean>('autoCompleteRefs')
    ) {
      autoInsertion.register(context, htmlClient, apiClient);
    }
  }

  async function registerRestartRequest() {
    await Promise.all(clients.map((client) => client.onReady()));

    context.subscriptions.push(
      commands.registerCommand('volar.action.restartServer', async () => {
        await Promise.all(clients.map((client) => client.stop()));
        await Promise.all(clients.map((client) => client.start()));
        registerClientRequests();
      })
    );
  }

  function registerClientRequests() {
    for (const client of clients) {
      showReferences.activate(context, client);
    }
  }
}

function getInitializationOptions(
  context: ExtensionContext,
  mode: 'main-language-features' | 'second-language-features' | 'document-features',
  useSecondServer: boolean
) {
  if (!resolveCurrentTsPaths) {
    resolveCurrentTsPaths = tsVersion.getCurrentTsPaths(context);
    context.workspaceState.update('coc-volar-ts-server-path', resolveCurrentTsPaths.serverPath);
  }

  const textDocumentSync = workspace
    .getConfiguration('volar')
    .get<'incremental' | 'full' | 'none'>('vueserver.textDocumentSync');
  const initializationOptions: VueServerInitializationOptions = {
    petiteVue: {
      processHtmlFile: processHtml(),
    },
    vitePress: {
      processMdFile: processMd(),
    },
    textDocumentSync: textDocumentSync
      ? {
          incremental: TextDocumentSyncKind.Incremental,
          full: TextDocumentSyncKind.Full,
          none: TextDocumentSyncKind.None,
        }[textDocumentSync]
      : TextDocumentSyncKind.Incremental,
    typescript: resolveCurrentTsPaths,
    languageFeatures:
      mode === 'main-language-features' || mode === 'second-language-features'
        ? {
            ...(mode === 'main-language-features'
              ? {
                  references: true,
                  implementation: true,
                  definition: true,
                  typeDefinition: true,
                  callHierarchy: true,
                  hover: true,
                  rename: true,
                  renameFileRefactoring: true,
                  signatureHelp: true,
                  codeAction: true,
                  workspaceSymbol: true,
                  completion: {
                    // **MEMO**:
                    // Set to false for coc-volar. Setting this to true, auto-imports, etc. will not work.
                    // May need to implement "activeSelection".
                    getDocumentSelectionRequest: false,
                  },
                  schemaRequestService: true,
                }
              : {}),
            ...(mode === 'second-language-features' || (mode === 'main-language-features' && !useSecondServer)
              ? {
                  documentHighlight: true,
                  documentLink: true,
                  codeLens: { showReferencesNotification: true },
                  semanticTokens: true,
                  inlayHints: true,
                  diagnostics: getConfigDiagnostics(),
                  schemaRequestService: true,
                }
              : {}),
          }
        : undefined,
    documentFeatures:
      mode === 'document-features'
        ? {
            selectionRange: true,
            foldingRange: true,
            linkedEditingRange: true,
            documentSymbol: true,
            documentColor: true,
            documentFormatting: getConfigDocumentFormatting(),
          }
        : undefined,
  };

  return initializationOptions;
}

export function deactivate(): Thenable<any> | undefined {
  return Promise.all([apiClient?.stop(), docClient?.stop(), htmlClient?.stop()].filter(shared.notEmpty));
}

export function takeOverModeEnabled() {
  return !!workspace.getConfiguration('volar').get<boolean>('takeOverMode.enabled');
}

function useSecondServer() {
  return !!workspace.getConfiguration('volar').get<boolean>('vueserver.useSecondServer');
}

export function processHtml() {
  return !!workspace.getConfiguration('volar').get<boolean>('vueserver.petiteVue.processHtmlFile');
}

export function processMd() {
  return !!workspace.getConfiguration('volar').get<boolean>('vueserver.vitePress.processMdFile');
}

function getConfigTagNameCase() {
  const tagNameCase = workspace.getConfiguration('volar').get<'both' | 'kebab' | 'pascal'>('completion.tagNameCase');
  switch (tagNameCase) {
    case 'both':
      return 'both' as const;
    case 'kebab':
      return 'kebabCase' as const;
    case 'pascal':
      return 'pascalCase' as const;
  }
  return 'both' as const;
}

function getConfigAttrNameCase() {
  const tagNameCase = workspace.getConfiguration('volar').get<'kebab' | 'camel'>('completion.attrNameCase');
  switch (tagNameCase) {
    case 'kebab':
      return 'kebabCase' as const;
    case 'camel':
      return 'camelCase' as const;
  }
  return 'kebabCase' as const;
}

function getConfigDiagnostics(): NonNullable<VueServerInitializationOptions['languageFeatures']>['diagnostics'] {
  return workspace.getConfiguration('volar').get<boolean>('diagnostics.enable', true);
}

function getConfigDocumentFormatting(): NonNullable<
  VueServerInitializationOptions['documentFeatures']
>['documentFormatting'] {
  const isFormattingEnable = workspace.getConfiguration('volar').get<boolean>('formatting.enable', true);

  if (isFormattingEnable) {
    return true;
  } else {
    return undefined;
  }
}

function initializeWorkspaceState(context: ExtensionContext) {
  context.workspaceState.update('coc-volar-ts-server-path', undefined);
}
