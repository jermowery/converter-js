import { Component, ChangeDetectionStrategy } from '@angular/core';
import { FormGroup, FormControl, Validators } from '@angular/forms';
import { Subject, Observable } from 'rxjs';
import { MatSnackBar } from '@angular/material/snack-bar';
import { doesNotReject } from 'assert';
import JSZip from 'jszip';
import {saveAs} from 'file-saver';

interface HTMLInputEvent extends Event {
  target: HTMLInputElement & EventTarget;
}

@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AppComponent {
  readonly formGroup = new FormGroup({
    'file': new FormControl(null, {
      validators: Validators.required,
    }),
  });

  private readonly fileUploadProgressSubject = new Subject<number>();
  readonly fileUploadProgress: Observable<number> = this.fileUploadProgressSubject;

  lastRecordedFile?: File | null;

  constructor(private readonly snackBar: MatSnackBar) { }

  async convertFile() {
    if (!this.lastRecordedFile) {
      return;
    }

    const fileReader = new FileReader();
    fileReader.addEventListener('loadstart', () => {
      this.fileUploadProgressSubject.next(0);
    });
    fileReader.addEventListener('loadend', () => {
      this.fileUploadProgressSubject.next(100);
    });
    fileReader.addEventListener('progress', event => {
      const progress = event.loaded / event.total;
      this.fileUploadProgressSubject.next(progress);
    });

    const fileTextPromise = new Promise<string>((resolve, reject) => {
      fileReader.addEventListener('load', () => {
        resolve(fileReader.result as string)
      });
      fileReader.addEventListener('error', () => {
        reject(fileReader.error)
      });
      fileReader.addEventListener('abort', () => {
        reject(fileReader.error)
      });
    });

    fileReader.readAsText(this.lastRecordedFile);

    const fileText = await fileTextPromise;
    const domProcessor = new DOMParser();
    const parsedDom = domProcessor.parseFromString(fileText, "application/xml");
    const hasError = parsedDom.getElementsByTagNameNS("*", "parsererror").length > 0;

    if (hasError) {
      this.snackBar.open("Could not parse file.");
      return;
    }

    const bookmarks = this.getBookmarks(parsedDom);

    const bookmarksByFileName = new Map<string, Element[]>();

    for (const bookmark of bookmarks) {
      const fileName = this.getFileName(bookmark);
      if (!fileName) {
        this.showWarningSnackBar();
        continue;
      }
      if (bookmarksByFileName.has(fileName)) {
        bookmarksByFileName.get(fileName)?.push(bookmark);
      } else {
        bookmarksByFileName.set(fileName, [bookmark]);
      }
    }

    const zip = new JSZip();

    for (const [fileName, bookmarks] of bookmarksByFileName) {
      const labelTrackFileContent = this.createLabelTrack(fileName, bookmarks);
      const outputFileName = `${fileName}_labelTrack.txt`;
      zip.file(outputFileName, labelTrackFileContent);
    }

    const zipContent = await zip.generateAsync({type:"blob"});
    saveAs(zipContent, "converted-bookmarks.zip", {autoBom: true});
  }

  private getBookmarks(document: Document) {
    return Array.from(document.getElementsByTagNameNS("*", "bookmark"));
  }

  private getFileName(bookmark: Element) {
    return bookmark.getElementsByTagNameNS("*", "fileName")[0].textContent;
  }

  private createLabelTrack(fileName: string, bookmarks: Element[]) {
    const lines: string[] = [];
    lines.push(`0\t0\t${fileName}`);

    for (let i = 0; i < bookmarks.length; i++) {
      const bookmark = bookmarks[i];
      const position = bookmark.getElementsByTagNameNS("*", "filePosition")[0].textContent;
      if (!position) {
        this.showWarningSnackBar();
        continue;
      }
      const labelTrackLine = `${position}\t${position}\t${i}`;
      lines.push(labelTrackLine);
    }

    return lines.join("\n");
  }

  recordFile(event: HTMLInputEvent) {
    if (!event.target.files) {
      return;
    }
    this.lastRecordedFile = event.target.files[0];
  }

  private showWarningSnackBar() {
    this.snackBar.open("Not all bookmarks could be processed some data may be missing.");
  }
}