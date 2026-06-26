import * as React from "react";
import { cn } from "@/lib/utils";

const Card = React.forwardRef(function Card({ className, ...props }, ref) {
  return (
    <div
      ref={ref}
      className={cn(
        "rounded-xl border border-zinc-200 bg-white text-zinc-950 shadow dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-50",
        className
      )}
      {...props}
    />
  );
});

const CardHeader = React.forwardRef(function CardHeader({ className, ...props }, ref) {
  return (
    <div ref={ref} className={cn("flex flex-col space-y-1.5 p-6", className)} {...props} />
  );
});

const CardTitle = React.forwardRef(function CardTitle({ className, ...props }, ref) {
  return (
    <h3
      ref={ref}
      className={cn("font-semibold leading-none tracking-tight text-2xl", className)}
      {...props}
    />
  );
});

const CardDescription = React.forwardRef(function CardDescription({ className, ...props }, ref) {
  return (
    <p ref={ref} className={cn("text-sm text-zinc-500 dark:text-zinc-400", className)} {...props} />
  );
});

const CardContent = React.forwardRef(function CardContent({ className, ...props }, ref) {
  return <div ref={ref} className={cn("p-6 pt-0", className)} {...props} />;
});

const CardFooter = React.forwardRef(function CardFooter({ className, ...props }, ref) {
  return (
    <div ref={ref} className={cn("flex items-center p-6 pt-0", className)} {...props} />
  );
});

export { Card, CardHeader, CardFooter, CardTitle, CardDescription, CardContent };