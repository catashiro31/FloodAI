import { Entity, Column, PrimaryColumn, CreateDateColumn, UpdateDateColumn, OneToMany } from "typeorm";
import { Task } from "./task.entity";

@Entity("sessions")
export class Session {
  @PrimaryColumn("uuid")
  session_id: string;

  @Column({ type: "text", nullable: true })
  user_id: string;

  @Column({ type: "jsonb", default: {} })
  context: any;

  @Column({ type: "jsonb", default: [] })
  history: any;

  @Column({ type: "text", nullable: true })
  last_question: string;

  @Column({ type: "text", nullable: true })
  last_reply: string;

  @CreateDateColumn({ type: "timestamptz" })
  created_at: Date;

  @UpdateDateColumn({ type: "timestamptz" })
  updated_at: Date;

  @OneToMany(() => Task, (task) => task.session)
  tasks: Task[];
}
