export type Maybe<T> = T | null;
export type InputMaybe<T> = Maybe<T>;
export type Exact<T extends { [key: string]: unknown }> = { [K in keyof T]: T[K] };
export type MakeOptional<T, K extends keyof T> = Omit<T, K> & { [SubKey in K]?: Maybe<T[SubKey]> };
export type MakeMaybe<T, K extends keyof T> = Omit<T, K> & { [SubKey in K]: Maybe<T[SubKey]> };
export type MakeEmpty<T extends { [key: string]: unknown }, K extends keyof T> = { [_ in K]?: never };
export type Incremental<T> = T | { [P in keyof T]?: P extends ' $fragmentName' | '__typename' ? T[P] : never };
/** All built-in and custom scalars, mapped to their actual values */
export type Scalars = {
  ID: { input: string; output: string; }
  String: { input: string; output: string; }
  Boolean: { input: boolean; output: boolean; }
  Int: { input: number; output: number; }
  Float: { input: number; output: number; }
};

export type Cart = {
  __typename?: 'Cart';
  cost: CartCost;
};

export type CartCost = {
  __typename?: 'CartCost';
  subtotalAmount: Money;
};

export type Discount = {
  __typename?: 'Discount';
  discountClasses: Array<Scalars['String']['output']>;
};

export type Money = {
  __typename?: 'Money';
  amount: Scalars['String']['output'];
  currencyCode: Scalars['String']['output'];
};

export type Query = {
  __typename?: 'Query';
  cart: Cart;
  discount: Discount;
};

export type CartInputQueryVariables = Exact<{ [key: string]: never; }>;


export type CartInputQuery = { __typename?: 'Query', cart: { __typename?: 'Cart', cost: { __typename?: 'CartCost', subtotalAmount: { __typename?: 'Money', amount: string, currencyCode: string } } }, discount: { __typename?: 'Discount', discountClasses: Array<string> } };
