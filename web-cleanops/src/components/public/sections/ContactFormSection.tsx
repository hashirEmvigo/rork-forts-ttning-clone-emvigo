import { useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { Check, CheckCircle2, Clock, Copy, Mail, MapPin, Send } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import type { ContactFormSectionConfig } from "@/lib/publicSite/types";

import { Eyebrow, Section } from "./sectionPrimitives";

/** Validation for the public contact form. */
const contactSchema = z.object({
  name: z.string().trim().min(2, "Please enter your name."),
  email: z.string().trim().email("Please enter a valid email address."),
  company: z.string().trim().optional(),
  message: z.string().trim().min(10, "Please add a few words about your needs."),
});

type ContactFormValues = z.infer<typeof contactSchema>;

/** Builds a `mailto:` link with the enquiry prefilled into the subject + body. */
function buildMailtoHref(to: string, values: ContactFormValues): string {
  const subject = `Website enquiry from ${values.name}`;
  const lines = [
    `Name: ${values.name}`,
    `Email: ${values.email}`,
    values.company ? `Company: ${values.company}` : null,
    "",
    values.message,
  ].filter((line): line is string => line !== null);
  return `mailto:${to}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(
    lines.join("\n"),
  )}`;
}

/**
 * Public contact section: intro + reassurance points beside a validated form.
 * On submit it opens the visitor's email client (mailto:) with the message
 * prefilled — there is no server-side inbox in this slice — then shows a clear
 * confirmation with a copy-email fallback.
 */
export function ContactFormSection({ section }: { section: ContactFormSectionConfig }) {
  const { eyebrow, heading, body, email, points } = section;
  const [submitted, setSubmitted] = useState<boolean>(false);
  const [copied, setCopied] = useState<boolean>(false);

  const form = useForm<ContactFormValues>({
    resolver: zodResolver(contactSchema),
    defaultValues: { name: "", email: "", company: "", message: "" },
  });

  const onSubmit = (values: ContactFormValues) => {
    // Open the visitor's email client with the enquiry ready to send.
    window.location.href = buildMailtoHref(email, values);
    setSubmitted(true);
  };

  const handleCopyEmail = async () => {
    try {
      await navigator.clipboard?.writeText(email);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard may be unavailable; the address is shown in full regardless.
    }
  };

  const sendAnother = () => {
    form.reset();
    setSubmitted(false);
  };

  return (
    <Section muted>
      <div className="grid items-start gap-10 lg:grid-cols-2 lg:gap-16">
        {/* Intro + contact details */}
        <div className="flex flex-col items-start gap-5">
          {eyebrow ? <Eyebrow>{eyebrow}</Eyebrow> : null}
          <h2 className="font-display text-3xl leading-tight tracking-tight text-foreground sm:text-4xl">
            {heading}
          </h2>
          {body && body.length > 0 ? (
            <div className="space-y-4">
              {body.map((paragraph, index) => (
                <p key={index} className="text-base leading-relaxed text-muted-foreground">
                  {paragraph}
                </p>
              ))}
            </div>
          ) : null}

          <a
            href={`mailto:${email}`}
            className="inline-flex items-center gap-2.5 rounded-xl border border-border bg-card px-4 py-3 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Mail className="h-4 w-4" />
            </span>
            {email}
          </a>

          {points && points.length > 0 ? (
            <ul className="space-y-2.5 pt-1">
              {points.map((point, index) => (
                <li key={point} className="flex items-start gap-2.5 text-sm text-foreground">
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-success/15 text-success">
                    {index === 0 ? (
                      <Clock className="h-3 w-3" />
                    ) : index === points.length - 1 ? (
                      <MapPin className="h-3 w-3" />
                    ) : (
                      <Check className="h-3 w-3" />
                    )}
                  </span>
                  {point}
                </li>
              ))}
            </ul>
          ) : null}
        </div>

        {/* Form card / success state */}
        <div className="rounded-2xl border border-border bg-card p-6 shadow-lg sm:p-8">
          {submitted ? (
            <div className="flex flex-col items-center gap-4 py-6 text-center">
              <span className="flex h-14 w-14 items-center justify-center rounded-full bg-success/15 text-success">
                <CheckCircle2 className="h-7 w-7" />
              </span>
              <div className="space-y-1.5">
                <h3 className="text-lg font-semibold text-foreground">Your email is ready to send</h3>
                <p className="mx-auto max-w-sm text-sm leading-relaxed text-muted-foreground">
                  We opened your email app with the message prefilled — just press send. If nothing
                  opened, email us directly:
                </p>
              </div>
              <div className="flex flex-wrap items-center justify-center gap-2">
                <a
                  href={`mailto:${email}`}
                  className="inline-flex items-center gap-2 rounded-lg bg-foreground px-3 py-2 text-sm font-medium text-background"
                >
                  <Mail className="h-4 w-4" />
                  {email}
                </a>
                <Button type="button" variant="outline" size="sm" onClick={() => void handleCopyEmail()}>
                  {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                  {copied ? "Copied" : "Copy"}
                </Button>
              </div>
              <Button type="button" variant="ghost" size="sm" onClick={sendAnother}>
                Send another message
              </Button>
            </div>
          ) : (
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4" noValidate>
                <div className="grid gap-4 sm:grid-cols-2">
                  <FormField
                    control={form.control}
                    name="name"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Name</FormLabel>
                        <FormControl>
                          <Input placeholder="Your name" autoComplete="name" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="company"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>
                          Company <span className="font-normal text-muted-foreground">(optional)</span>
                        </FormLabel>
                        <FormControl>
                          <Input placeholder="Company name" autoComplete="organization" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
                <FormField
                  control={form.control}
                  name="email"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Email</FormLabel>
                      <FormControl>
                        <Input
                          type="email"
                          placeholder="you@company.com"
                          autoComplete="email"
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="message"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Message</FormLabel>
                      <FormControl>
                        <Textarea
                          rows={4}
                          placeholder="Tell us about your cleaning operation and what you'd like to improve."
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <Button type="submit" size="lg" className="w-full">
                  <Send className="h-4 w-4" />
                  Send message
                </Button>
                <p className="text-center text-xs text-muted-foreground">
                  This opens your email app with the message ready to send.
                </p>
              </form>
            </Form>
          )}
        </div>
      </div>
    </Section>
  );
}
