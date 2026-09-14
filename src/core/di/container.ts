export type InjectionToken<T> = symbol & { readonly __type?: T };

export const createToken = <T>(description: string): InjectionToken<T> =>
  Symbol(description) as InjectionToken<T>;

type Factory<T> = (container: Container) => T;

export class ProviderRegistry {
  private readonly factories = new Map<InjectionToken<unknown>, Factory<unknown>>();

  register<T>(token: InjectionToken<T>, factory: Factory<T>): this {
    this.factories.set(token, factory);
    return this;
  }

  createScope(): Container {
    return new Container(this.factories);
  }
}

export class Container {
  private readonly instances = new Map<InjectionToken<unknown>, unknown>();

  constructor(
    private readonly factories: ReadonlyMap<InjectionToken<unknown>, Factory<unknown>>,
  ) {}

  set<T>(token: InjectionToken<T>, value: T): this {
    this.instances.set(token, value);
    return this;
  }

  resolve<T>(token: InjectionToken<T>): T {
    if (this.instances.has(token)) {
      return this.instances.get(token) as T;
    }

    const factory = this.factories.get(token) as Factory<T> | undefined;
    if (!factory) {
      throw new Error(`No provider registered for ${token.description ?? "unknown token"}`);
    }

    const instance = factory(this);
    this.instances.set(token, instance);
    return instance;
  }
}
