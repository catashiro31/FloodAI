import { Entity, Column, PrimaryColumn, CreateDateColumn, UpdateDateColumn, ManyToOne, JoinColumn } from "typeorm";
import { Session } from "./session.entity";
export { TaskStatus } from "../../common/task-status";
import { TaskStatus } from "../../common/task-status";

@Entity("tasks")
export class Task {
  @PrimaryColumn("uuid")
  job_id: string;

  @Column("uuid")
  session_id: string;

  @ManyToOne(() => Session, (session) => session.tasks)
  @JoinColumn({ name: "session_id" })
  session: Session;

  @Column("text")
  image_url: string;

  @Column({
    type: "enum",
    enum: TaskStatus,
    default: TaskStatus.Queued,
  })
  status: TaskStatus;

  @Column("text", { nullable: true })
  question: string;

  @Column("text", { nullable: true })
  mask_all_overlay: string;

  @Column("jsonb", { nullable: true, default: {} })
  metrics: Record<string, any>;

  @Column("text", { nullable: true })
  vlm_analysis: string;

  @Column("text", { nullable: true })
  error_code: string;

  @Column("text", { nullable: true })
  error_message: string;

  @Column("timestamptz", { nullable: true })
  segmentation_callback_at: Date;

  @Column("timestamptz", { nullable: true })
  vlm_callback_at: Date;

  @CreateDateColumn({ type: "timestamptz" })
  created_at: Date;

  @UpdateDateColumn({ type: "timestamptz" })
  updated_at: Date;
}
