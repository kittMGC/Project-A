import { greet } from "./greet.js";

function main(): void {
  const name = process.argv[2] ?? "world";
  console.log(greet(name));
}

main();
