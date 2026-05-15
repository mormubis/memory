type Clock = () => Date;

const defaultClock: Clock = () => new Date();

export { defaultClock };
export type { Clock };
