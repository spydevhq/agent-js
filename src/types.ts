export {}; // This makes the file a module

declare global {
    namespace NodeJS {
        interface Process {
            _rawDebug: (message?: any, ...optionalParams: any[]) => void;
        }
    }
}
