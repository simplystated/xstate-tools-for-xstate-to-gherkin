import { ImplementationsMetadata } from '@xstate/tools-shared';
import { compressToEncodedURIComponent } from 'lz-string';
import { assign, createMachine, interpret, MachineConfig } from 'xstate';

declare global {
  function acquireVsCodeApi(): {
    postMessage: (event: EditorWebviewScriptEvent) => void;
  };
}

export interface WebViewMachineContext {
  config: MachineConfig<any, any, any>;
  uri: string;
  index: number;
  layoutString: string | undefined;
  implementations: ImplementationsMetadata;
  baseUrl: string;
  themeKind: 'light' | 'dark';
}

export type EditorWebviewScriptEvent =
  | {
      type: 'RECEIVE_SERVICE';
      config: MachineConfig<any, any, any>;
      layoutString: string | undefined;
      uri: string;
      index: number;
      implementations: ImplementationsMetadata;
      baseUrl: string;
      themeKind: any;
    }
  | {
      type: 'NODE_SELECTED';
      path: string[];
    }
  | {
      type: 'OPEN_LINK';
      url: string;
    }
  | VSCodeNodeSelectedEvent
  | {
      type: 'RECEIVE_CONFIG_UPDATE_FROM_VSCODE';
      config: MachineConfig<any, any, any>;
      uri: string;
      index: number;
      layoutString: string;
      implementations: ImplementationsMetadata;
    }
  | {
      type: 'DEFINITION_UPDATED';
      layoutString: string;
      config: MachineConfig<any, any, any>;
      implementations: ImplementationsMetadata;
    }
  | UpdateDefinitionEvent
  | VSCodeOpenLinkEvent;

export type VSCodeNodeSelectedEvent = {
  type: 'vscode.selectNode';
  path: string[];
  uri: string;
  index: number;
};

export type VSCodeOpenLinkEvent = {
  type: 'vscode.openLink';
  url: string;
};

export type UpdateDefinitionEvent = {
  type: 'vscode.updateDefinition';
  config: MachineConfig<any, any, any>;
  layoutString: string;
  uri: string;
  index: number;
  implementations: ImplementationsMetadata;
};

let vscodeApi: ReturnType<typeof acquireVsCodeApi>;

const getVsCodeApi = () => {
  if (!vscodeApi) {
    vscodeApi = acquireVsCodeApi();
  }

  return vscodeApi;
};

const machine = createMachine<WebViewMachineContext, EditorWebviewScriptEvent>(
  {
    initial: 'waitingForFirstContact',
    context: {
      config: {},
      uri: '',
      index: 0,
      layoutString: undefined,
      implementations: {
        actions: {},
        guards: {},
        services: {},
      },
      baseUrl: '',
      themeKind: 'dark',
    },
    invoke: {
      src: () => (send) => {
        const listener = (event: MessageEvent) => {
          try {
            const ourEvent: EditorWebviewScriptEvent = JSON.parse(event.data);

            send(ourEvent);
          } catch (e) {
            console.warn(e);
          }
        };
        window.addEventListener('message', listener);

        return () => window.removeEventListener('message', listener);
      },
    },
    on: {
      NODE_SELECTED: {
        actions: (context, event) => {
          getVsCodeApi().postMessage({
            type: 'vscode.selectNode',
            index: context.index,
            uri: context.uri,
            path: event.path,
          });
        },
      },

      OPEN_LINK: {
        actions: (_, event) => {
          getVsCodeApi().postMessage({
            type: 'vscode.openLink',
            url: event.url,
          });
        },
      },
    },

    states: {
      waitingForFirstContact: {
        on: {
          RECEIVE_SERVICE: {
            target: 'hasService',
            actions: assign((_context, event) => {
              return {
                config: event.config,
                index: event.index,
                uri: event.uri,
                layoutString: event.layoutString,
                implementations: event.implementations,
                baseUrl: event.baseUrl,
                themeKind: event.themeKind,
              };
            }),
            internal: false,
          },
        },
      },
      hasService: {
        invoke: {
          src: (context) => () => {
            const iframe = document.getElementById(
              'iframe',
            ) as HTMLIFrameElement;

            if (!iframe || iframe.src) return;

            /**
             * We add runningInStatelyExtension to the iframe's src.
             * This is used by `useVsCode` in the editor to check that the extension is running the web app.
             * */
            iframe.src = `${
              context.baseUrl
            }/registry/editor/from-url?runningInStatelyExtension=true&themeKind=${
              context.themeKind
            }&config=${compressToEncodedURIComponent(
              JSON.stringify(context.config),
            )}${
              context.layoutString ? `&layout=${context.layoutString}` : ''
            }&implementations=${compressToEncodedURIComponent(
              JSON.stringify(context.implementations),
            )}}`;
          },
        },
        on: {
          RECEIVE_SERVICE: {
            actions: [
              assign((_context, event) => {
                return {
                  config: event.config,
                  index: event.index,
                  uri: event.uri,
                  layoutString: event.layoutString,
                  implementations: event.implementations,
                  baseUrl: event.baseUrl,
                  themeKind: event.themeKind,
                };
              }),
              'updateIframe',
            ],
          },
          RECEIVE_CONFIG_UPDATE_FROM_VSCODE: {
            cond: (ctx, event) => {
              // Ensure that the update is from the machine we are editing
              return event.uri === ctx.uri && ctx.index === event.index;
            },
            actions: [
              assign((ctx, event) => {
                return {
                  config: event.config,
                  layoutString: event.layoutString,
                  implementations: event.implementations,
                };
              }),
              'updateIframe',
            ],
          },
          DEFINITION_UPDATED: {
            actions: [
              assign((context, event) => {
                return {
                  config: event.config,
                  layoutString: event.layoutString,
                  implementations: event.implementations,
                };
              }),
              (ctx, event) => {
                getVsCodeApi().postMessage({
                  type: 'vscode.updateDefinition',
                  config: event.config,
                  index: ctx.index,
                  uri: ctx.uri,
                  layoutString: event.layoutString,
                  implementations: event.implementations,
                });
              },
            ],
          },
        },
      },
    },
  },
  {
    actions: {
      updateIframe: (context) => {
        const iframe = document.getElementById('iframe') as HTMLIFrameElement;

        if (!iframe) return;

        iframe.contentWindow!.postMessage(
          {
            config: context.config,
            layoutString: context.layoutString,
            type: 'UPDATE_CONFIG',
            implementations: context.implementations,
          },
          '*',
        );
      },
    },
  },
);

interpret(machine).start();
